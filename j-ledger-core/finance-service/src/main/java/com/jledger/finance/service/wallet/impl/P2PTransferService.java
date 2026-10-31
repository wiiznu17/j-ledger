package com.jledger.finance.service.wallet.impl;

import com.jledger.finance.service.wallet.WalletService;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jledger.finance.config.JLedgerProperties;
import com.jledger.finance.domain.entity.Account;
import com.jledger.finance.domain.entity.LedgerEntry;
import com.jledger.finance.domain.entity.SystemSettings;
import com.jledger.finance.domain.entity.Transaction;
import com.jledger.finance.domain.entity.Wallet;
import com.jledger.finance.domain.enums.TransactionStatus;
import com.jledger.finance.domain.enums.TransactionType;
import com.jledger.finance.dto.LedgerLeg;
import com.jledger.finance.exception.ConflictException;
import com.jledger.finance.exception.ResourceNotFoundException;
import com.jledger.finance.repository.ledger.AccountRepository;
import com.jledger.finance.repository.ledger.LedgerEntryRepository;
import com.jledger.finance.repository.transaction.TransactionRepository;
import com.jledger.finance.repository.wallet.WalletRepository;
import com.jledger.finance.service.compliance.SystemService;
import com.jledger.finance.util.MonetaryRounding;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class P2PTransferService {

    private final WalletRepository walletRepository;
    private final TransactionRepository transactionRepository;
    private final AccountRepository accountRepository;
    private final LedgerEntryRepository ledgerEntryRepository;
    private final JdbcTemplate jdbcTemplate;
    private final SystemService systemService;
    private final ObjectMapper objectMapper;
    private final WalletCacheService walletCacheService;
    private final WalletCommonService walletCommonService;
    private final JLedgerProperties jLedgerProperties;

    @Transactional
    public Transaction transferByPhone(String fromUserId, String toPhone, BigDecimal amount) {
        log.info("transferByPhone called: fromUserId={}, toPhone={}, amount={}", fromUserId, toPhone, amount);
        String recipientUserId = findUserIdByPhone(toPhone);
        log.info("Found recipientUserId: {}", recipientUserId);
        return transferByPhoneInternal(fromUserId, toPhone, recipientUserId, amount, null, null, null);
    }

    public Map<String, Object> previewTransferByPhone(String fromUserId, String recipientPhone, BigDecimal amount) {
        log.info("previewTransferByPhone called: fromUserId={}, recipientPhone={}", fromUserId, recipientPhone);
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Transfer amount must be greater than zero");
        }

        Wallet fromWallet = walletRepository.findByUserId(fromUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));
        if (!fromWallet.getIsActive()) {
            throw new IllegalArgumentException("Source wallet is inactive");
        }

        String recipientUserId = findUserIdByPhone(recipientPhone);
        log.info("Found recipientUserId: {}", recipientUserId);
        if (fromUserId.equals(recipientUserId)) {
            throw new IllegalArgumentException("Cannot transfer to your own account");
        }

        Wallet toWallet = walletRepository.findByUserId(recipientUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Recipient wallet not found"));
        if (!toWallet.getIsActive()) {
            throw new IllegalArgumentException("Recipient wallet is inactive");
        }
        if (fromWallet.getBalance().compareTo(amount) < 0) {
            throw new IllegalArgumentException("Insufficient balance");
        }

        BigDecimal fee = BigDecimal.ZERO.setScale(4);
        BigDecimal totalDebit = amount.add(fee);
        Map<String, Object> recipient = new HashMap<>();
        recipient.put("userId", recipientUserId);
        recipient.put("phoneMasked", maskPhone(recipientPhone));

        Map<String, Object> response = new HashMap<>();
        response.put("recipient", recipient);
        response.put("amount", amount.setScale(4));
        response.put("fee", fee);
        response.put("totalDebit", totalDebit.setScale(4));
        response.put("currency", fromWallet.getCurrency() == null ? "THB" : fromWallet.getCurrency());
        return response;
    }

    @Transactional
    public Transaction transferByPhoneV1(
            String fromUserId,
            String recipientPhone,
            BigDecimal amount,
            String note,
            String idempotencyKey,
            Object metadata
    ) {
        log.info("transferByPhoneV1 called: fromUserId={}, recipientPhone={}, amount={}, idempotencyKey={}", fromUserId, recipientPhone, amount, idempotencyKey);
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey is required");
        }
        Optional<Transaction> existing = transactionRepository.findByTransactionId(idempotencyKey);
        if (existing.isPresent()) {
            log.info("Transaction already exists with idempotencyKey: {}", idempotencyKey);
            return existing.get();
        }
        String recipientUserId = findUserIdByPhone(recipientPhone);
        log.info("Found recipientUserId: {}", recipientUserId);
        return transferByPhoneInternal(fromUserId, recipientPhone, recipientUserId, amount, note, idempotencyKey, metadata);
    }

    @Transactional
    protected Transaction transferByPhoneInternal(
            String fromUserId,
            String normalizedPhone,
            String recipientUserId,
            BigDecimal amount,
            String note,
            String idempotencyKey,
            Object metadata
    ) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Transfer amount must be greater than zero");
        }
        if (fromUserId.equals(recipientUserId)) {
            throw new IllegalArgumentException("Cannot transfer to your own account");
        }

        try {
            Wallet fromWallet, toWallet;
            if (fromUserId.compareTo(recipientUserId) < 0) {
                fromWallet = walletRepository.findByUserIdForUpdate(fromUserId)
                        .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));
                toWallet = walletRepository.findByUserIdForUpdate(recipientUserId)
                        .orElseThrow(() -> new ResourceNotFoundException("Recipient wallet not found"));
            } else {
                toWallet = walletRepository.findByUserIdForUpdate(recipientUserId)
                        .orElseThrow(() -> new ResourceNotFoundException("Recipient wallet not found"));
                fromWallet = walletRepository.findByUserIdForUpdate(fromUserId)
                        .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));
            }

            if (!fromWallet.getIsActive()) {
                throw new IllegalArgumentException("Source wallet is inactive");
            }
            if (!toWallet.getIsActive()) {
                throw new IllegalArgumentException("Recipient wallet is inactive");
            }
            if (fromWallet.getBalance().compareTo(amount) < 0) {
                throw new IllegalArgumentException("Insufficient balance");
            }

            fromWallet.setBalance(fromWallet.getBalance().subtract(amount));
            toWallet.setBalance(toWallet.getBalance().add(amount));
            
            Account senderAccount = walletCommonService.getOrCreateLedgerAccount(fromUserId, fromWallet.getCurrency());
            Account receiverAccount = walletCommonService.getOrCreateLedgerAccount(recipientUserId, toWallet.getCurrency());
            
            senderAccount.setBalance(senderAccount.getBalance().subtract(amount));
            receiverAccount.setBalance(receiverAccount.getBalance().add(amount));
            
            accountRepository.save(senderAccount);
            accountRepository.save(receiverAccount);
            
            String txId = walletCommonService.generateReadableTransactionId();
            
            LedgerEntry senderEntry = LedgerEntry.builder()
                    .account(senderAccount)
                    .entryType("DEBIT")
                    .amount(amount)
                    .transactionId(txId)
                    .description(String.format("Transfer to %s", normalizedPhone))
                    .build();
            ledgerEntryRepository.save(Objects.requireNonNull(senderEntry));
            
            LedgerEntry receiverEntry = LedgerEntry.builder()
                    .account(receiverAccount)
                    .entryType("CREDIT")
                    .amount(amount)
                    .transactionId(txId)
                    .description(String.format("Transfer from %s", fromUserId))
                    .build();
            ledgerEntryRepository.save(Objects.requireNonNull(receiverEntry));

            Wallet updatedFrom = walletRepository.save(Objects.requireNonNull(fromWallet));
            Wallet updatedTo = walletRepository.save(Objects.requireNonNull(toWallet));
            walletCacheService.cacheWallet(updatedFrom);
            walletCacheService.cacheWallet(updatedTo);

            Transaction transaction = new Transaction();
            transaction.setTransactionId(txId);
            transaction.setType(TransactionType.TRANSFER);
            transaction.setAmount(amount);
            transaction.setStatus(TransactionStatus.COMPLETED);
            transaction.setFromWalletId(fromWallet.getId());
            transaction.setToWalletId(toWallet.getId());
            transaction.setFromAccountId(senderAccount.getId());
            transaction.setToAccountId(receiverAccount.getId());
            transaction.setDescription("Transfer to phone " + normalizedPhone);
            transaction.setMetadata(buildTransferMetadata(normalizedPhone, recipientUserId, note, idempotencyKey, metadata));
            
            Transaction savedTransaction = transactionRepository.save(transaction);

            walletCommonService.publishTransactionEvent(fromUserId, savedTransaction, false, recipientUserId);
            walletCommonService.publishTransactionEvent(recipientUserId, savedTransaction, true, fromUserId);

            return savedTransaction;

        } catch (DataIntegrityViolationException e) {
            if (idempotencyKey != null) {
                return transactionRepository.findByTransactionId(idempotencyKey)
                        .orElseThrow(() -> new ConflictException("Transaction conflict detected but record not found", e));
            }
            throw e;
        }
    }

    @Transactional
    public Transaction transferByWalletId(String fromUserId, String toWalletId, BigDecimal amount, Object metadata) {
        Wallet fromWalletInfo = walletRepository.findByUserId(fromUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));

        Long toWalletIdLong;
        try {
            toWalletIdLong = Long.parseLong(toWalletId);
        } catch (NumberFormatException e) {
            return transferWalletToAccount(fromUserId, toWalletId, amount, metadata);
        }
        
        Long fromWalletId = fromWalletInfo.getId();

        Wallet fromWallet;
        Wallet toWallet;
        if (fromWalletId < toWalletIdLong) {
            fromWallet = walletRepository.findByIdForUpdate(fromWalletId)
                    .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));
            toWallet = walletRepository.findByIdForUpdate(toWalletIdLong)
                    .orElseThrow(() -> new ResourceNotFoundException("Recipient wallet not found"));
        } else if (fromWalletId > toWalletIdLong) {
            toWallet = walletRepository.findByIdForUpdate(toWalletIdLong)
                    .orElseThrow(() -> new ResourceNotFoundException("Recipient wallet not found"));
            fromWallet = walletRepository.findByIdForUpdate(fromWalletId)
                    .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));
        } else {
            throw new IllegalArgumentException("Cannot transfer to the same wallet");
        }

        if (!fromWallet.getIsActive()) {
            throw new IllegalArgumentException("Source wallet is inactive");
        }

        if (fromWallet.getBalance().compareTo(amount) < 0) {
            throw new IllegalArgumentException("Insufficient balance");
        }

        if (!toWallet.getIsActive()) {
            throw new IllegalArgumentException("Recipient wallet is inactive");
        }

        Account senderAccountInfo = walletCommonService.getOrCreateLedgerAccount(fromUserId, fromWallet.getCurrency());
        Account receiverAccountInfo = walletCommonService.getOrCreateLedgerAccount(toWallet.getUserId(), toWallet.getCurrency());
        
        Account senderAccount;
        Account receiverAccount;
        
        if (senderAccountInfo.getId().compareTo(receiverAccountInfo.getId()) < 0) {
            senderAccount = accountRepository.findByIdForUpdate(senderAccountInfo.getId()).get();
            receiverAccount = accountRepository.findByIdForUpdate(receiverAccountInfo.getId()).get();
        } else if (senderAccountInfo.getId().compareTo(receiverAccountInfo.getId()) > 0) {
            receiverAccount = accountRepository.findByIdForUpdate(receiverAccountInfo.getId()).get();
            senderAccount = accountRepository.findByIdForUpdate(senderAccountInfo.getId()).get();
        } else {
            senderAccount = receiverAccount = accountRepository.findByIdForUpdate(senderAccountInfo.getId()).get();
        }

        fromWallet.setBalance(fromWallet.getBalance().subtract(amount));
        toWallet.setBalance(toWallet.getBalance().add(amount));
        
        senderAccount.setBalance(senderAccount.getBalance().subtract(amount));
        receiverAccount.setBalance(receiverAccount.getBalance().add(amount));
        
        accountRepository.save(senderAccount);
        accountRepository.save(receiverAccount);

        walletRepository.save(Objects.requireNonNull(fromWallet));
        walletRepository.save(Objects.requireNonNull(toWallet));
        walletCacheService.cacheWallet(fromWallet);
        walletCacheService.cacheWallet(toWallet);

        String txId = walletCommonService.generateReadableTransactionId();
        Transaction transaction = new Transaction();
        transaction.setTransactionId(txId);
        transaction.setType(TransactionType.TRANSFER);
        transaction.setAmount(amount);
        transaction.setStatus(TransactionStatus.COMPLETED);
        transaction.setFromWalletId(fromWallet.getId());
        transaction.setToWalletId(toWallet.getId());
        transaction.setFromAccountId(senderAccount.getId());
        transaction.setToAccountId(receiverAccount.getId());
        transaction.setDescription("Transfer to wallet " + toWalletId);
        
        Map<String, Object> metaMap = new HashMap<>();
        metaMap.put("toWalletId", toWalletId);
        if (metadata != null) {
            if (metadata instanceof Map<?, ?> map) {
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    metaMap.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            } else {
                metaMap.put("extra", metadata);
            }
        }
        try {
            transaction.setMetadata(objectMapper.writeValueAsString(metaMap));
        } catch (Exception e) {
            log.warn("Failed to serialize metadata for transfer: {}", e.getMessage());
        }

        Transaction savedTransaction = transactionRepository.save(transaction);
        
        walletCommonService.recordLedgerEntries(senderAccount, receiverAccount, amount, savedTransaction.getTransactionId(), "Transfer to wallet " + toWalletId);
        
        walletCommonService.publishTransactionEvent(fromUserId, savedTransaction, false);
        walletCommonService.publishTransactionEvent(toWallet.getUserId(), savedTransaction, true);

        return savedTransaction;
    }

    @Transactional
    public Transaction transferWalletToAccount(String fromUserId, String toAccountId, BigDecimal amount, Object metadata) {
        Wallet fromWallet = walletRepository.findByUserIdForUpdate(fromUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Source wallet not found"));

        if (!fromWallet.getIsActive()) {
            throw new IllegalArgumentException("Source wallet is inactive");
        }

        if (fromWallet.getBalance().compareTo(amount) < 0) {
            throw new IllegalArgumentException("Insufficient balance");
        }

        UUID toAccountUuid = UUID.fromString(toAccountId);
        Account receiverAccount = accountRepository.findByIdForUpdate(toAccountUuid)
                .orElseThrow(() -> new ResourceNotFoundException("Recipient account not found: " + toAccountId));

        Account senderAccount = walletCommonService.getOrCreateLedgerAccount(fromUserId, fromWallet.getCurrency());
        senderAccount = accountRepository.findByIdForUpdate(senderAccount.getId()).get();

        fromWallet.setBalance(fromWallet.getBalance().subtract(amount));
        senderAccount.setBalance(senderAccount.getBalance().subtract(amount));
        receiverAccount.setBalance(receiverAccount.getBalance().add(amount));

        walletRepository.save(fromWallet);
        walletCacheService.cacheWallet(fromWallet);
        accountRepository.save(senderAccount);
        accountRepository.save(receiverAccount);

        String txId = walletCommonService.generateReadableTransactionId();
        Transaction transaction = new Transaction();
        transaction.setTransactionId(txId);
        transaction.setType(TransactionType.PAYMENT);
        transaction.setAmount(amount);
        transaction.setStatus(TransactionStatus.COMPLETED);
        transaction.setFromWalletId(fromWallet.getId());
        transaction.setToWalletId(null);
        transaction.setFromAccountId(senderAccount.getId());
        transaction.setToAccountId(UUID.fromString(toAccountId));
        transaction.setDescription("Merchant payment to account " + toAccountId);
        
        Map<String, Object> metaMap = new HashMap<>();
        if (metadata != null) {
            if (metadata instanceof Map<?, ?> map) {
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    metaMap.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            } else if (metadata instanceof String strMetadata && !strMetadata.isBlank()) {
                try {
                    Map<String, Object> map = objectMapper.readValue(strMetadata, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
                    metaMap.putAll(map);
                } catch (Exception e) {
                    metaMap.put("extra", metadata);
                }
            } else {
                metaMap.put("extra", metadata);
            }
        }
        try {
            transaction.setMetadata(objectMapper.writeValueAsString(metaMap));
        } catch (Exception e) {
            log.warn("Failed to serialize metadata for wallet-to-account: {}", e.getMessage());
        }

        Transaction savedTransaction = transactionRepository.save(transaction);

        walletCommonService.recordLedgerEntries(senderAccount, receiverAccount, amount, txId, "Merchant payment to " + toAccountId);

        walletCommonService.publishTransactionEvent(fromUserId, savedTransaction, false);
        walletCommonService.publishTransactionEvent(receiverAccount.getUserId().toString(), savedTransaction, true);

        return savedTransaction;
    }

    public Transaction transferByQR(String fromUserId, String qrData, BigDecimal amount) {
        String toWalletId = qrData;
        return transferByWalletId(fromUserId, toWalletId, amount, null);
    }

    public String generateQR(String userId, BigDecimal amount) {
        Wallet wallet = walletRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Wallet not found"));

        return "jledger|qr|" + wallet.getId() + "|" + amount.toString();
    }

    @Transactional
    public Transaction payQR(String fromUserId, String qrData, BigDecimal amount) {
        return transferByQR(fromUserId, qrData, amount);
    }

    @Transactional
    public Transaction payUtilityBill(String userId, String billerCode, String accountNumber, BigDecimal amount) {
        Wallet wallet = walletRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Wallet not found"));

        if (!wallet.getIsActive()) {
            throw new IllegalArgumentException("Wallet is inactive");
        }

        SystemSettings settings = systemService.getSystemSettings();
        BigDecimal fixedFee = settings.getBillPaymentFeeFixed() != null ? settings.getBillPaymentFeeFixed() : BigDecimal.ZERO;
        BigDecimal percentFee = settings.getBillPaymentFeePercentage() != null ? settings.getBillPaymentFeePercentage() : BigDecimal.ZERO;
        
        BigDecimal percentageFeeAmount = MonetaryRounding.calculatePercentageFee(amount, percentFee);
        BigDecimal totalFee = fixedFee.add(percentageFeeAmount);
        BigDecimal totalDebit = amount.add(totalFee);

        if (wallet.getBalance().compareTo(totalDebit) < 0) {
            throw new IllegalArgumentException("Insufficient balance to cover bill and fees. Required: " + totalDebit);
        }

        wallet.setBalance(wallet.getBalance().subtract(totalDebit));
        walletRepository.save(Objects.requireNonNull(wallet));
        walletCacheService.cacheWallet(wallet);

        Transaction transaction = new Transaction();
        transaction.setTransactionId(walletCommonService.generateReadableTransactionId());
        transaction.setType(TransactionType.BILL_PAYMENT);
        transaction.setAmount(amount);
        transaction.setStatus(TransactionStatus.COMPLETED);
        transaction.setFromWalletId(wallet.getId());
        transaction.setToWalletId(null);
        transaction.setDescription("Utility bill payment to " + billerCode);
        try {
            Map<String, Object> meta = Map.of(
                    "billersCode", billerCode,
                    "accountNumber", accountNumber
            );
            transaction.setMetadata(objectMapper.writeValueAsString(meta));
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize bill payment metadata", e);
        }

        Transaction savedTransaction = transactionRepository.save(transaction);

        if (totalFee.compareTo(BigDecimal.ZERO) > 0) {
            Transaction feeTx = new Transaction();
            feeTx.setTransactionId(walletCommonService.generateReadableTransactionId());
            feeTx.setType(TransactionType.BILL_PAYMENT);
            feeTx.setAmount(totalFee);
            feeTx.setStatus(TransactionStatus.COMPLETED);
            feeTx.setFromWalletId(wallet.getId());
            feeTx.setToWalletId(null);
            feeTx.setDescription("Service fee for bill payment: " + billerCode);
            try {
                Map<String, Object> feeMeta = Map.of(
                        "isFee", true,
                        "parentTransactionId", savedTransaction.getTransactionId()
                );
                feeTx.setMetadata(objectMapper.writeValueAsString(feeMeta));
            } catch (Exception e) {
                throw new RuntimeException("Failed to serialize fee metadata", e);
            }
            transactionRepository.save(feeTx);
        }

        recordBillPaymentLedger(userId, wallet.getCurrency(), savedTransaction.getTransactionId(),
                amount, totalFee, totalDebit, "Utility bill payment to " + billerCode);

        walletCommonService.publishTransactionEvent(userId, savedTransaction, false);

        return savedTransaction;
    }

    @Transactional
    public Transaction payCreditCardBill(String userId, String cardNumber, BigDecimal amount) {
        Wallet wallet = walletRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Wallet not found"));

        if (!wallet.getIsActive()) {
            throw new IllegalArgumentException("Wallet is inactive");
        }

        SystemSettings settings = systemService.getSystemSettings();
        BigDecimal fixedFee = settings.getBillPaymentFeeFixed() != null ? settings.getBillPaymentFeeFixed() : BigDecimal.ZERO;
        BigDecimal percentFee = settings.getBillPaymentFeePercentage() != null ? settings.getBillPaymentFeePercentage() : BigDecimal.ZERO;
        
        BigDecimal percentageFeeAmount = MonetaryRounding.calculatePercentageFee(amount, percentFee);
        BigDecimal totalFee = fixedFee.add(percentageFeeAmount);
        BigDecimal totalDebit = amount.add(totalFee);

        if (wallet.getBalance().compareTo(totalDebit) < 0) {
            throw new IllegalArgumentException("Insufficient balance to cover bill and fees. Required: " + totalDebit);
        }

        wallet.setBalance(wallet.getBalance().subtract(totalDebit));
        walletRepository.save(Objects.requireNonNull(wallet));
        walletCacheService.cacheWallet(wallet);

        Transaction transaction = new Transaction();
        transaction.setTransactionId(walletCommonService.generateReadableTransactionId());
        transaction.setType(TransactionType.BILL_PAYMENT);
        transaction.setAmount(amount);
        transaction.setStatus(TransactionStatus.COMPLETED);
        transaction.setFromWalletId(wallet.getId());
        transaction.setToWalletId(null);
        transaction.setDescription("Credit card payment: " + cardNumber);
        try {
            Map<String, Object> meta = Map.of("cardNumber", cardNumber);
            transaction.setMetadata(objectMapper.writeValueAsString(meta));
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize credit card payment metadata", e);
        }

        Transaction savedTransaction = transactionRepository.save(transaction);

        if (totalFee.compareTo(BigDecimal.ZERO) > 0) {
            Transaction feeTx = new Transaction();
            feeTx.setTransactionId(walletCommonService.generateReadableTransactionId());
            feeTx.setType(TransactionType.BILL_PAYMENT);
            feeTx.setAmount(totalFee);
            feeTx.setStatus(TransactionStatus.COMPLETED);
            feeTx.setFromWalletId(wallet.getId());
            feeTx.setToWalletId(null);
            feeTx.setDescription("Service fee for credit card payment: " + cardNumber);
            try {
                Map<String, Object> feeMeta = Map.of(
                        "isFee", true,
                        "parentTransactionId", savedTransaction.getTransactionId()
                );
                feeTx.setMetadata(objectMapper.writeValueAsString(feeMeta));
            } catch (Exception e) {
                throw new RuntimeException("Failed to serialize fee metadata", e);
            }
            transactionRepository.save(feeTx);
        }

        recordBillPaymentLedger(userId, wallet.getCurrency(), savedTransaction.getTransactionId(),
                amount, totalFee, totalDebit, "Credit card payment: " + cardNumber);

        walletCommonService.publishTransactionEvent(userId, savedTransaction, false);

        return savedTransaction;
    }

    private void recordBillPaymentLedger(String userId, String currency, String transactionId,
                                         BigDecimal amount, BigDecimal totalFee, BigDecimal totalDebit,
                                         String description) {
        Account senderAccount = walletCommonService.getOrCreateLedgerAccount(userId, currency);
        Account systemAccount = accountRepository.findById(jLedgerProperties.getSystem().getAccountId())
                .orElseThrow(() -> new ResourceNotFoundException("System account not found"));

        List<LedgerLeg> legs = new ArrayList<>();
        legs.add(LedgerLeg.debit(senderAccount, totalDebit, description));
        legs.add(LedgerLeg.credit(systemAccount, amount, description + " (Principal)"));

        if (totalFee != null && totalFee.compareTo(BigDecimal.ZERO) > 0) {
            Account feeAccount = accountRepository.findById(jLedgerProperties.getSystem().getFeeAccountId())
                    .orElseThrow(() -> new ResourceNotFoundException("System fee account not found"));
            legs.add(LedgerLeg.credit(feeAccount, totalFee, "Service fee"));
        }

        BigDecimal roundingDiff = totalDebit.subtract(amount).subtract(totalFee != null ? totalFee : BigDecimal.ZERO);
        if (roundingDiff.compareTo(BigDecimal.ZERO) != 0) {
            Account roundingAccount = accountRepository.findById(jLedgerProperties.getSystem().getRoundingDifferenceAccountId())
                    .orElseThrow(() -> new ResourceNotFoundException("System rounding difference account not found"));
            if (roundingDiff.compareTo(BigDecimal.ZERO) > 0) {
                legs.add(LedgerLeg.credit(roundingAccount, roundingDiff.abs(), "Rounding adjustment"));
            } else {
                legs.add(LedgerLeg.debit(roundingAccount, roundingDiff.abs(), "Rounding adjustment"));
            }
        }

        walletCommonService.recordMultiLegEntry(transactionId, legs);
    }

    @Transactional
    public Transaction payMobileTopup(String userId, String phoneNumber, BigDecimal amount) {
        Wallet wallet = walletRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Wallet not found"));

        if (!wallet.getIsActive()) {
            throw new IllegalArgumentException("Wallet is inactive");
        }

        if (wallet.getBalance().compareTo(amount) < 0) {
            throw new IllegalArgumentException("Insufficient balance");
        }

        wallet.setBalance(wallet.getBalance().subtract(amount));
        walletRepository.save(Objects.requireNonNull(wallet));
        walletCacheService.cacheWallet(wallet);

        Transaction transaction = new Transaction();
        transaction.setTransactionId(walletCommonService.generateReadableTransactionId());
        transaction.setType(TransactionType.MOBILE_TOPUP);
        transaction.setAmount(amount);
        transaction.setStatus(TransactionStatus.COMPLETED);
        transaction.setFromWalletId(wallet.getId());
        transaction.setToWalletId(null);
        transaction.setDescription("Mobile top-up for " + phoneNumber);
        try {
            Map<String, Object> meta = Map.of("phoneNumber", phoneNumber);
            transaction.setMetadata(objectMapper.writeValueAsString(meta));
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize mobile top-up metadata", e);
        }

        Transaction savedTransaction = transactionRepository.save(transaction);
        walletCommonService.publishTransactionEvent(userId, savedTransaction, false);

        return savedTransaction;
    }

    private String findUserIdByPhone(String phone) {
        log.info("=== findUserIdByPhone START ===");
        log.info("Input phone: '{}'", phone);
        
        String e164Phone = normalizePhoneToE164(phone);
        log.info("Normalized to E.164: '{}'", e164Phone);
        
        List<String> phoneVariations = getPhoneCandidates(e164Phone);
        log.info("Generated {} phone variations: {}", phoneVariations.size(), phoneVariations);
        
        for (String variation : phoneVariations) {
            log.info("Trying variation: '{}'", variation);
            String sql = "SELECT id FROM identity.users WHERE \"phoneNumber\" = ? LIMIT 1";
            List<String> ids = jdbcTemplate.query(sql, (rs, rowNum) -> rs.getString("id"), variation);
            log.info("Query returned {} results for variation: '{}'", ids.size(), variation);
            
            if (!ids.isEmpty()) {
                log.info("=== findUserIdByPhone END (SUCCESS) ===");
                return ids.get(0);
            }
        }
        
        try {
            String debugSql = "SELECT id, \"phoneNumber\" FROM identity.users LIMIT 5";
            List<Map<String, Object>> samples = jdbcTemplate.queryForList(debugSql);
            log.warn("Sample users in database: {}", samples);
        } catch (Exception e) {
            log.error("Failed to query sample users", e);
        }
        
        log.error("=== findUserIdByPhone END (NOT FOUND) ===");
        throw new ResourceNotFoundException("Recipient not found");
    }

    private List<String> getPhoneCandidates(String e164Phone) {
        List<String> candidates = new ArrayList<>();
        String digits = e164Phone.replaceAll("\\D", "");
        
        candidates.add(e164Phone);
        
        if (digits.startsWith("66") && digits.length() == 11) {
            candidates.add("0" + digits.substring(2));
        }
        
        log.debug("Phone candidates generated: {}", candidates);
        return candidates;
    }

    private String normalizePhoneToE164(String phone) {
        log.info("normalizePhoneToE164 input: '{}'", phone);
        if (phone == null) {
            throw new IllegalArgumentException("recipientPhone is required");
        }
        String digits = phone.replaceAll("\\D", "");
        log.info("Digits after removing non-digits: '{}'", digits);
        
        if (digits.startsWith("66") && digits.length() == 11) {
            String result = "+66" + digits.substring(2);
            log.info("Case: starts with 66, length 11 -> '{}'", result);
            return result;
        }
        if (digits.startsWith("0") && digits.length() == 10) {
            String result = "+66" + digits.substring(1);
            log.info("Case: starts with 0, length 10 -> '{}'", result);
            return result;
        }
        if (digits.length() == 9) {
            String result = "+66" + digits;
            log.info("Case: length 9 -> '{}'", result);
            return result;
        }
        if (phone.startsWith("+")) {
            log.info("Case: already has + prefix -> '{}'", phone);
            return phone;
        }
        String result = "+66" + digits;
        log.info("Case: default -> '{}'", result);
        return result;
    }

    private String maskPhone(String phone) {
        return phone.substring(0, 3) + "-***-" + phone.substring(phone.length() - 3);
    }

    private String buildTransferMetadata(String phone, String recipientUserId, String note, String idempotencyKey, Object extraMetadata) {
        Map<String, Object> metaMap = new HashMap<>();
        metaMap.put("recipientPhone", phone);
        metaMap.put("recipientUserId", recipientUserId);
        metaMap.put("note", note == null ? "" : note);
        metaMap.put("idempotencyKey", idempotencyKey == null ? "" : idempotencyKey);

        if (extraMetadata instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                metaMap.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        }

        try {
            return objectMapper.writeValueAsString(metaMap);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize transfer metadata", e);
        }
    }
}
