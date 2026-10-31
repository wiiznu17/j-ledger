package com.jledger.finance.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("MonetaryRounding Unit Tests")
class MonetaryRoundingTest {

    @Test
    @DisplayName("Should use Banker's Rounding (HALF_EVEN) to 2 decimal places")
    void shouldRoundMonetaryUsingHalfEven() {
        // Even numbers before 5 round down
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.225")))
                .isEqualByComparingTo("2.22");
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.245")))
                .isEqualByComparingTo("2.24");

        // Odd numbers before 5 round up
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.215")))
                .isEqualByComparingTo("2.22");
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.235")))
                .isEqualByComparingTo("2.24");

        // Normal rounding rules for non-.5 cases
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.226")))
                .isEqualByComparingTo("2.23");
        assertThat(MonetaryRounding.roundMonetary(new BigDecimal("2.224")))
                .isEqualByComparingTo("2.22");
    }

    @Test
    @DisplayName("Should round to internal precision (4 decimal places) using HALF_EVEN")
    void shouldRoundInternalUsingHalfEven() {
        // 2.12345 -> even 4 rounds down to 2.1234
        assertThat(MonetaryRounding.roundInternal(new BigDecimal("2.12345")))
                .isEqualByComparingTo("2.1234");
        // 2.12335 -> odd 3 rounds up to 2.1234
        assertThat(MonetaryRounding.roundInternal(new BigDecimal("2.12335")))
                .isEqualByComparingTo("2.1234");
    }

    @ParameterizedTest(name = "amount={0}, percentage={1}% => expected={2}")
    @CsvSource({
            "1000.00, 0.50, 5.0000",
            "100.00, 0.35, 0.3500",
            "333.33, 0.30, 0.99999 -> 1.0000",
            "0.00, 1.50, 0.0000"
    })
    @DisplayName("Should calculate percentage fee correctly")
    void shouldCalculatePercentageFee(String amountStr, String percentStr, String expectedStr) {
        BigDecimal amount = new BigDecimal(amountStr);
        BigDecimal percentage = new BigDecimal(percentStr);
        BigDecimal fee = MonetaryRounding.calculatePercentageFee(amount, percentage);
        if (expectedStr.contains("->")) {
            expectedStr = expectedStr.substring(expectedStr.indexOf("->") + 2).trim();
        }
        assertThat(fee).isEqualByComparingTo(expectedStr);
    }

    @Test
    @DisplayName("Should handle null inputs gracefully in roundMonetary and roundInternal")
    void shouldHandleNullInputsGracefully() {
        assertThat(MonetaryRounding.roundMonetary(null))
                .isEqualByComparingTo("0.00");
        assertThat(MonetaryRounding.roundInternal(null))
                .isEqualByComparingTo("0.0000");
        assertThat(MonetaryRounding.calculatePercentageFee(null, new BigDecimal("1.0")))
                .isEqualByComparingTo("0.0000");
        assertThat(MonetaryRounding.calculatePercentageFee(new BigDecimal("100"), null))
                .isEqualByComparingTo("0.0000");
    }

    @Test
    @DisplayName("Should calculate rounding difference correctly")
    void shouldCalculateRoundingDifference() {
        // totalDebit = 100.00, principal = 99.99, fee = 0.00 => diff = 0.01
        BigDecimal diff = MonetaryRounding.roundingDifference(
                new BigDecimal("100.00"),
                new BigDecimal("99.99"),
                new BigDecimal("0.00")
        );
        assertThat(diff).isEqualByComparingTo("0.01");

        // Exactly balanced
        BigDecimal balanced = MonetaryRounding.roundingDifference(
                new BigDecimal("105.50"),
                new BigDecimal("100.00"),
                new BigDecimal("5.50")
        );
        assertThat(balanced).isEqualByComparingTo("0.00");

        // Deficit: totalDebit = 100.00, legs = 90.00 + 11.00 => diff = -1.00
        BigDecimal deficit = MonetaryRounding.roundingDifference(
                new BigDecimal("100.00"),
                new BigDecimal("90.00"),
                new BigDecimal("11.00")
        );
        assertThat(deficit).isEqualByComparingTo("-1.00");
    }
}
