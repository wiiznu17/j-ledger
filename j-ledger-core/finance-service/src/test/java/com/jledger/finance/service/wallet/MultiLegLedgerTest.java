package com.jledger.finance.service.wallet;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jledger.finance.domain.entity.Account;
import com.jledger.finance.domain.entity.LedgerEntry;
import com.jledger.finance.domain.enums.AccountType;
import com.jledger.finance.dto.LedgerLeg;
import com.jledger.finance.repository.ledger.AccountRepository;
import com.jledger.finance.repository.ledger.LedgerEntryRepository;
import com.jledger.finance.repository.system.IntegrationOutboxRepository;
import com.jledger.finance.service.wallet.impl.WalletCommonService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("Multi-leg Ledger Unit Tests")
class MultiLegLedgerTest {

    @Mock
    private AccountRepository accountRepository;

    @Mock
    private LedgerEntryRepository ledgerEntryRepository;

    @Mock
    private IntegrationOutboxRepository integrationOutboxRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private ObjectMapper objectMapper;

    private WalletCommonService walletCommonService;

    private Account userAccount;
    private Account systemAccount;
    private Account feeAccount;
    private Account roundingAccount;

    @BeforeEach
    void setUp() {
        walletCommonService = new WalletCommonService(
                accountRepository,
                ledgerEntryRepository,
                integrationOutboxRepository,
                jdbcTemplate,
                objectMapper
        );

        userAccount = Account.builder()
                .id(UUID.randomUUID())
                .userId(UUID.randomUUID())
                .accountName("User Wallet Account")
                .accountType(AccountType.WALLET)
                .balance(new BigDecimal("1000.0000"))
                .currency("THB")
                .build();

        systemAccount = Account.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000000"))
                .userId(UUID.fromString("00000000-0000-0000-0000-000000000000"))
                .accountName("SYSTEM_BANK_ACCOUNT")
                .accountType(AccountType.BANK_CLEARING)
                .balance(BigDecimal.ZERO)
                .currency("THB")
                .build();

        feeAccount = Account.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                .userId(UUID.fromString("00000000-0000-0000-0000-000000000000"))
                .accountName("SYSTEM_FEE_ACCOUNT")
                .accountType(AccountType.FEE)
                .balance(BigDecimal.ZERO)
                .currency("THB")
                .build();

        roundingAccount = Account.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000002"))
                .userId(UUID.fromString("00000000-0000-0000-0000-000000000000"))
                .accountName("SYSTEM_ROUNDING_ACCOUNT")
                .accountType(AccountType.ROUNDING_DIFFERENCE)
                .balance(BigDecimal.ZERO)
                .currency("THB")
                .build();
    }

    @Test
    @DisplayName("Should successfully record balanced 3-leg entry (Debit User = Credit System + Credit Fee)")
    void shouldRecordBalanced3LegEntry() {
        String txId = "TXN_TEST_001";
        BigDecimal amount = new BigDecimal("100.00");
        BigDecimal fee = new BigDecimal("5.00");
        BigDecimal totalDebit = new BigDecimal("105.00");

        List<LedgerLeg> legs = List.of(
                LedgerLeg.debit(userAccount, totalDebit, "Bill Payment"),
                LedgerLeg.credit(systemAccount, amount, "Principal"),
                LedgerLeg.credit(feeAccount, fee, "Fee")
        );

        walletCommonService.recordMultiLegEntry(txId, legs);

        ArgumentCaptor<LedgerEntry> captor = ArgumentCaptor.forClass(LedgerEntry.class);
        verify(ledgerEntryRepository, times(3)).save(captor.capture());

        List<LedgerEntry> savedEntries = captor.getAllValues();
        BigDecimal totalDebitSaved = savedEntries.stream()
                .filter(e -> "DEBIT".equals(e.getEntryType()))
                .map(LedgerEntry::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalCreditSaved = savedEntries.stream()
                .filter(e -> "CREDIT".equals(e.getEntryType()))
                .map(LedgerEntry::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        assertThat(totalDebitSaved).isEqualByComparingTo(totalCreditSaved);
        assertThat(totalDebitSaved).isEqualByComparingTo("105.00");
    }

    @Test
    @DisplayName("Should absorb rounding discrepancy into ROUNDING_DIFFERENCE account")
    void shouldAbsorbRoundingDiscrepancyIntoRoundingAccount() {
        String txId = "TXN_TEST_ROUNDING";
        // User pays 100.00, biller gets 99.99, fee is 0.00, difference 0.01 absorbed by rounding account
        BigDecimal totalDebit = new BigDecimal("100.00");
        BigDecimal principal = new BigDecimal("99.99");
        BigDecimal diff = totalDebit.subtract(principal); // 0.01

        List<LedgerLeg> legs = List.of(
                LedgerLeg.debit(userAccount, totalDebit, "Payment"),
                LedgerLeg.credit(systemAccount, principal, "Principal"),
                LedgerLeg.credit(roundingAccount, diff, "Rounding adjustment")
        );

        walletCommonService.recordMultiLegEntry(txId, legs);

        verify(ledgerEntryRepository, times(3)).save(any(LedgerEntry.class));
    }

    @Test
    @DisplayName("Should throw IllegalStateException when ΣDebit != ΣCredit")
    void shouldThrowWhenLedgerImbalanced() {
        String txId = "TXN_IMBALANCED";
        List<LedgerLeg> imbalancedLegs = List.of(
                LedgerLeg.debit(userAccount, new BigDecimal("100.00"), "Debit"),
                LedgerLeg.credit(systemAccount, new BigDecimal("95.00"), "Credit")
        );

        assertThatThrownBy(() -> walletCommonService.recordMultiLegEntry(txId, imbalancedLegs))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Ledger imbalance detected")
                .hasMessageContaining("discrepancy=5.00");

        verify(ledgerEntryRepository, times(2)).save(any(LedgerEntry.class));
    }

    @Test
    @DisplayName("Should throw IllegalArgumentException when legs are null or empty")
    void shouldThrowWhenLegsNullOrEmpty() {
        assertThatThrownBy(() -> walletCommonService.recordMultiLegEntry("TXN_1", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> walletCommonService.recordMultiLegEntry("TXN_1", List.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Should skip legs with zero amount without causing imbalance")
    void shouldSkipZeroAmountLegs() {
        String txId = "TXN_ZERO_FEE";
        List<LedgerLeg> legs = List.of(
                LedgerLeg.debit(userAccount, new BigDecimal("100.00"), "Payment"),
                LedgerLeg.credit(systemAccount, new BigDecimal("100.00"), "Principal"),
                LedgerLeg.credit(feeAccount, BigDecimal.ZERO, "Zero fee")
        );

        walletCommonService.recordMultiLegEntry(txId, legs);

        // Only 2 non-zero entries saved
        verify(ledgerEntryRepository, times(2)).save(any(LedgerEntry.class));
    }

    @Test
    @DisplayName("LedgerLeg should enforce validation constraints")
    void shouldValidateLedgerLegConstraints() {
        assertThatThrownBy(() -> new LedgerLeg(null, "DEBIT", BigDecimal.TEN, "Desc"))
                .isInstanceOf(NullPointerException.class)
                .hasMessageContaining("Account");

        assertThatThrownBy(() -> new LedgerLeg(userAccount, null, BigDecimal.TEN, "Desc"))
                .isInstanceOf(NullPointerException.class)
                .hasMessageContaining("EntryType");

        assertThatThrownBy(() -> new LedgerLeg(userAccount, "INVALID", BigDecimal.TEN, "Desc"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("EntryType must be either DEBIT or CREDIT");

        assertThatThrownBy(() -> new LedgerLeg(userAccount, "DEBIT", new BigDecimal("-1.00"), "Desc"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be negative");
    }
}
