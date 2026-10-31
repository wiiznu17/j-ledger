package com.jledger.finance.service.wallet.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jledger.finance.domain.entity.Account;
import com.jledger.finance.domain.entity.IntegrationOutbox;
import com.jledger.finance.domain.entity.LedgerEntry;
import com.jledger.finance.domain.entity.Transaction;
import com.jledger.finance.domain.enums.NotificationEventType;
import com.jledger.finance.dto.LedgerLeg;
import com.jledger.finance.repository.ledger.AccountRepository;
import com.jledger.finance.repository.ledger.LedgerEntryRepository;
import com.jledger.finance.repository.system.IntegrationOutboxRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class WalletCommonService {

    private final AccountRepository accountRepository;
    private final LedgerEntryRepository ledgerEntryRepository;
    private final IntegrationOutboxRepository integrationOutboxRepository;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public String generateReadableTransactionId() {
        return "TXN" + com.jledger.finance.util.Ulid.fast().toString();
    }

    public Account getOrCreateLedgerAccount(String userId, String currency) {
        UUID userUuid = UUID.fromString(userId);
        return accountRepository.findByUserId(userUuid).stream().findFirst()
                .orElseGet(() -> {
                    String accountName = "User Wallet Account";
                    try {
                        String sql = "SELECT \"phoneNumber\" FROM identity.users WHERE id = ? LIMIT 1";
                        String phoneNumber = jdbcTemplate.queryForObject(sql, String.class, userId);
                        if (phoneNumber != null && !phoneNumber.isBlank()) {
                            accountName = "Wallet: " + phoneNumber;
                        }
                    } catch (Exception e) {
                        log.warn("Could not fetch phone number for userId: {}, defaulting to 'System Account' if system-like", userId);
                        if (userId.startsWith("00000000")) {
                            accountName = "System Account";
                        }
                    }

                    Account newAcc = Account.builder()
                            .userId(userUuid)
                            .accountName(accountName)
                            .accountType(userId.startsWith("00000000") ? com.jledger.finance.domain.enums.AccountType.SYSTEM_REVENUE : com.jledger.finance.domain.enums.AccountType.WALLET)
                            .balance(BigDecimal.ZERO)
                            .currency(currency != null ? currency : "THB")
                            .status("ACTIVE")
                            .kycStatus(com.jledger.finance.domain.enums.KycStatus.APPROVED)
                            .version(1)
                            .build();
                    return accountRepository.save(Objects.requireNonNull(newAcc));
                });
    }

    @Transactional
    public void recordLedgerEntries(Account fromAccount, Account toAccount, BigDecimal amount, String transactionId, String description) {
        if (fromAccount != null) {
            LedgerEntry debitEntry = LedgerEntry.builder()
                    .account(fromAccount)
                    .entryType("DEBIT")
                    .amount(amount)
                    .transactionId(transactionId)
                    .description(description != null ? description : "Ledger Transfer (Debit)")
                    .build();
            ledgerEntryRepository.save(Objects.requireNonNull(debitEntry));
        }

        if (toAccount != null) {
            LedgerEntry creditEntry = LedgerEntry.builder()
                    .account(toAccount)
                    .entryType("CREDIT")
                    .amount(amount)
                    .transactionId(transactionId)
                    .description(description != null ? description : "Ledger Transfer (Credit)")
                    .build();
            ledgerEntryRepository.save(Objects.requireNonNull(creditEntry));
        }
    }

    /**
     * Records a multi-leg journal entry ensuring sum(Debit) == sum(Credit).
     *
     * @param transactionId the business transaction ID
     * @param legs the list of debit and credit legs
     */
    @Transactional
    public void recordMultiLegEntry(String transactionId, List<LedgerLeg> legs) {
        if (legs == null || legs.isEmpty()) {
            throw new IllegalArgumentException("Legs cannot be null or empty");
        }

        BigDecimal totalDebit = BigDecimal.ZERO;
        BigDecimal totalCredit = BigDecimal.ZERO;

        for (LedgerLeg leg : legs) {
            if (leg == null || leg.amount() == null) {
                continue;
            }
            if (leg.amount().compareTo(BigDecimal.ZERO) == 0) {
                continue;
            }

            LedgerEntry entry = LedgerEntry.builder()
                    .account(leg.account())
                    .entryType(leg.entryType())
                    .amount(leg.amount())
                    .transactionId(transactionId)
                    .description(leg.description())
                    .build();
            ledgerEntryRepository.save(Objects.requireNonNull(entry));

            if ("DEBIT".equalsIgnoreCase(leg.entryType())) {
                totalDebit = totalDebit.add(leg.amount());
            } else if ("CREDIT".equalsIgnoreCase(leg.entryType())) {
                totalCredit = totalCredit.add(leg.amount());
            } else {
                throw new IllegalArgumentException("Unsupported entry type: " + leg.entryType());
            }
        }

        if (totalDebit.compareTo(BigDecimal.ZERO) <= 0 && totalCredit.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Multi-leg entry must have non-zero amounts");
        }

        if (totalDebit.compareTo(totalCredit) != 0) {
            throw new IllegalStateException(
                    String.format("Ledger imbalance detected for txn %s: Total Debit=%s, Total Credit=%s (discrepancy=%s)",
                            transactionId, totalDebit, totalCredit, totalDebit.subtract(totalCredit)));
        }
    }

    public void publishTransactionEvent(String userId, Transaction transaction, boolean isReceiver) {
        publishTransactionEvent(userId, transaction, isReceiver, null);
    }

    public void publishTransactionEvent(String userId, Transaction transaction, boolean isReceiver, String otherPartyUserId) {
        try {
            Map<String, Object> event = new HashMap<>();
            event.put("userId", userId);
            
            NotificationEventType notificationType = switch (transaction.getType()) {
                case TOPUP -> NotificationEventType.TOPUP;
                case TRANSFER -> NotificationEventType.TRANSFER;
                case WITHDRAWAL -> NotificationEventType.WITHDRAW;
                case BILL_PAYMENT -> NotificationEventType.BILL_PAYMENT;
                default -> NotificationEventType.FINANCE;
            };
            event.put("eventType", notificationType.name());
            
            event.put("amount", transaction.getAmount());
            event.put("referenceId", transaction.getTransactionId() != null ? transaction.getTransactionId() : transaction.getId().toString());
            event.put("status", transaction.getStatus().name());
            event.put("description", transaction.getDescription());
            event.put("timestamp", LocalDateTime.now().toString());

            Map<String, Object> metadata = new HashMap<>();
            metadata.put("transactionId", transaction.getId());
            metadata.put("amount", transaction.getAmount());
            metadata.put("description", transaction.getDescription());
            metadata.put("isReceiver", isReceiver);

            if (otherPartyUserId != null) {
                if (isReceiver) {
                    metadata.put("senderUserId", otherPartyUserId);
                } else {
                    metadata.put("recipientUserId", otherPartyUserId);
                }
            }
            
            if (transaction.getMetadata() != null && !transaction.getMetadata().isBlank()) {
                try {
                    Map<String, Object> txMetadata = objectMapper.readValue(transaction.getMetadata(), new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
                    metadata.putAll(txMetadata);
                    
                    if (txMetadata.containsKey("bankName")) {
                        metadata.put("source", txMetadata.get("bankName"));
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse transaction metadata for outbox: {}", e.getMessage());
                }
            }

            if (!metadata.containsKey("source") && transaction.getDescription() != null) {
                if (transaction.getDescription().contains("Stripe")) {
                    metadata.put("source", "Credit Card (Stripe)");
                }
            }
            
            event.put("metadata", metadata);

            IntegrationOutbox outbox = IntegrationOutbox.builder()
                    .eventType("FINANCE")
                    .payload(objectMapper.valueToTree(event))
                    .status("PENDING")
                    .build();

            integrationOutboxRepository.save(Objects.requireNonNull(outbox));
            log.info("[Outbox] Saved transaction event for user {}: {}", userId, transaction.getType());
        } catch (Exception e) {
            log.error("Failed to save transaction event to outbox", e);
        }
    }
}
