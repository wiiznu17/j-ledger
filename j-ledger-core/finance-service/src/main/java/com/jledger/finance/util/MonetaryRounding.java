package com.jledger.finance.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Centralized monetary rounding rules for the J-Ledger system.
 * Uses Banker's Rounding (HALF_EVEN) to eliminate statistical bias.
 */
public final class MonetaryRounding {

    /** Internal computation scale (sub-cent precision, 4 decimal places) */
    public static final int INTERNAL_SCALE = 4;

    /** Monetary display and settlement scale (standard 2 decimal places) */
    public static final int MONETARY_SCALE = 2;

    /** Banker's Rounding — statistically unbiased */
    public static final RoundingMode ROUNDING_MODE = RoundingMode.HALF_EVEN;

    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100");

    private MonetaryRounding() {
        // Utility class
    }

    /**
     * Round a value to internal precision (4 decimal places) using Banker's Rounding.
     */
    public static BigDecimal roundInternal(BigDecimal value) {
        if (value == null) {
            return BigDecimal.ZERO.setScale(INTERNAL_SCALE, ROUNDING_MODE);
        }
        return value.setScale(INTERNAL_SCALE, ROUNDING_MODE);
    }

    /**
     * Round a value to standard monetary precision (2 decimal places) using Banker's Rounding.
     */
    public static BigDecimal roundMonetary(BigDecimal value) {
        if (value == null) {
            return BigDecimal.ZERO.setScale(MONETARY_SCALE, ROUNDING_MODE);
        }
        return value.setScale(MONETARY_SCALE, ROUNDING_MODE);
    }

    /**
     * Calculate percentage-based fee with Banker's Rounding to INTERNAL_SCALE (4 decimal places).
     *
     * @param amount base amount
     * @param percentage fee percentage (e.g. 0.5 means 0.5%)
     * @return fee amount rounded to INTERNAL_SCALE
     */
    public static BigDecimal calculatePercentageFee(BigDecimal amount, BigDecimal percentage) {
        if (amount == null || percentage == null) {
            return BigDecimal.ZERO.setScale(INTERNAL_SCALE, ROUNDING_MODE);
        }
        return amount.multiply(percentage).divide(ONE_HUNDRED, INTERNAL_SCALE, ROUNDING_MODE);
    }

    /**
     * Calculate percentage-based fee with Banker's Rounding to specified scale.
     */
    public static BigDecimal calculatePercentageFee(BigDecimal amount, BigDecimal percentage, int scale) {
        if (amount == null || percentage == null) {
            return BigDecimal.ZERO.setScale(scale, ROUNDING_MODE);
        }
        return amount.multiply(percentage).divide(ONE_HUNDRED, scale, ROUNDING_MODE);
    }

    /**
     * Calculate rounding difference: totalDebit - sum(creditLegs).
     * Returns positive if totalDebit > sum(creditLegs), negative if totalDebit < sum(creditLegs).
     */
    public static BigDecimal roundingDifference(BigDecimal totalDebit, BigDecimal... creditLegs) {
        BigDecimal debit = totalDebit != null ? totalDebit : BigDecimal.ZERO;
        BigDecimal totalCredits = BigDecimal.ZERO;
        if (creditLegs != null) {
            for (BigDecimal leg : creditLegs) {
                if (leg != null) {
                    totalCredits = totalCredits.add(leg);
                }
            }
        }
        return debit.subtract(totalCredits);
    }
}
