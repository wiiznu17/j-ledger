package com.jledger.finance.service.system.impl;

import com.jledger.finance.domain.entity.TreasuryBankAccount;
import com.jledger.finance.domain.entity.TreasuryPayout;
import com.jledger.finance.domain.entity.Transaction;
import com.jledger.finance.domain.enums.TransactionStatus;
import com.jledger.finance.domain.enums.TransactionType;
import com.jledger.finance.dto.TreasurySummaryResponse;
import com.jledger.finance.repository.system.TreasuryBankAccountRepository;
import com.jledger.finance.repository.system.TreasuryPayoutRepository;
import com.jledger.finance.repository.transaction.TransactionRepository;
import com.jledger.finance.repository.wallet.WalletRepository;
import com.jledger.finance.service.system.TreasuryService;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class TreasuryServiceImpl implements TreasuryService {

    private final TreasuryBankAccountRepository bankAccountRepository;
    private final TreasuryPayoutRepository payoutRepository;
    private final TransactionRepository transactionRepository;
    private final WalletRepository walletRepository;
    private final ObjectMapper objectMapper;

    @Override
    public TreasurySummaryResponse getSummary() {
        BigDecimal totalTopups = transactionRepository.sumAmountByTypeAndStatus(TransactionType.TOPUP, TransactionStatus.COMPLETED);
        if (totalTopups == null) totalTopups = BigDecimal.ZERO;

        BigDecimal totalPayouts = payoutRepository.findAll().stream()
                .filter(p -> "COMPLETED".equals(p.getStatus()))
                .map(TreasuryPayout::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal stripeBalance = totalTopups.subtract(totalPayouts);

        List<TreasuryBankAccount> bankAccounts = bankAccountRepository.findAll();
        BigDecimal totalBankBalance = bankAccounts.stream()
                .map(TreasuryBankAccount::getBalance)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal totalCustomerLiability = walletRepository.sumAllBalances();
        if (totalCustomerLiability == null) totalCustomerLiability = BigDecimal.ZERO;

        BigDecimal totalAssets = stripeBalance.add(totalBankBalance);
        BigDecimal reserveRatio = BigDecimal.ZERO;
        if (totalCustomerLiability.compareTo(BigDecimal.ZERO) > 0) {
            reserveRatio = totalAssets.multiply(new BigDecimal("100"))
                    .divide(totalCustomerLiability, 2, RoundingMode.HALF_EVEN);
        }

        TreasurySummaryResponse response = new TreasurySummaryResponse();
        response.setStripeBalance(stripeBalance);
        response.setTotalBankBalance(totalBankBalance);
        response.setTotalCustomerLiability(totalCustomerLiability);
        response.setReserveRatio(reserveRatio);
        
        List<TreasurySummaryResponse.BankAccountSummary> summaries = bankAccounts.stream()
                .map(acc -> new TreasurySummaryResponse.BankAccountSummary(
                        acc.getName(),
                        acc.getBankName(),
                        acc.getAccountNumber(),
                        acc.getBalance(),
                        acc.getProvider()
                ))
                .collect(Collectors.toList());
        response.setBankAccounts(summaries);

        return response;
    }

    @Override
    @Transactional
    public void recordStripePayoutConfirmed(String stripePayoutId, BigDecimal amount, LocalDateTime arrivalDate) {
        if (payoutRepository.findByStripePayoutId(stripePayoutId).isPresent()) {
            return;
        }

        TreasuryBankAccount destinationAccount = bankAccountRepository.findByProvider("SCB")
                .orElseThrow(() -> new RuntimeException("Destination bank account not found"));

        TreasuryPayout payout = new TreasuryPayout();
        payout.setStripePayoutId(stripePayoutId);
        payout.setAmount(amount);
        payout.setStatus("COMPLETED");
        payout.setDestinationAccount(destinationAccount);
        payout.setArrivalDate(arrivalDate);
        payout.setNote("Automated payout from Stripe");
        payoutRepository.save(payout);

        destinationAccount.setBalance(destinationAccount.getBalance().add(amount));
        bankAccountRepository.save(destinationAccount);

        String txId = generateReadableTransactionId();
        Transaction tx = new Transaction();
        tx.setTransactionId(txId);
        tx.setReferenceId(stripePayoutId);
        tx.setType(TransactionType.WITHDRAWAL);
        tx.setAmount(amount);
        tx.setStatus(TransactionStatus.COMPLETED);
        tx.setDescription("Stripe payout sweep to corporate bank account: SCB (" + destinationAccount.getAccountNumber() + ")");
        tx.setCompletedAt(arrivalDate);
        try {
            Map<String, Object> meta = Map.of(
                    "stripePayoutId", stripePayoutId,
                    "note", "Automated payout from Stripe to SCB Main Corporate"
            );
            tx.setMetadata(objectMapper.writeValueAsString(meta));
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize payout metadata", e);
        }
        transactionRepository.save(tx);
    }
    
    private String generateReadableTransactionId() {
        return "TXN" + com.jledger.finance.util.Ulid.fast().toString();
    }
    
    @Override
    public List<TreasuryPayout> getPayoutHistory() {
        return payoutRepository.findAll();
    }
}
