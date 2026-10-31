package com.jledger.finance.dto;

import com.jledger.finance.domain.entity.Account;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * Represents a single leg (debit or credit) in a multi-leg journal entry.
 */
public record LedgerLeg(
        Account account,
        String entryType,   // "DEBIT" or "CREDIT"
        BigDecimal amount,
        String description
) {
    public LedgerLeg {
        Objects.requireNonNull(account, "Account must not be null");
        Objects.requireNonNull(entryType, "EntryType must not be null");
        Objects.requireNonNull(amount, "Amount must not be null");
        if (!"DEBIT".equalsIgnoreCase(entryType) && !"CREDIT".equalsIgnoreCase(entryType)) {
            throw new IllegalArgumentException("EntryType must be either DEBIT or CREDIT, was: " + entryType);
        }
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Amount must not be negative, was: " + amount);
        }
        entryType = entryType.toUpperCase();
    }

    public static LedgerLeg debit(Account account, BigDecimal amount, String description) {
        return new LedgerLeg(account, "DEBIT", amount, description);
    }

    public static LedgerLeg credit(Account account, BigDecimal amount, String description) {
        return new LedgerLeg(account, "CREDIT", amount, description);
    }
}
