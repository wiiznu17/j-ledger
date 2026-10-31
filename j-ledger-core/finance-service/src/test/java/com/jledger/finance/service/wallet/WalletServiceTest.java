package com.jledger.finance.service.wallet;

import com.jledger.finance.config.JLedgerProperties;
import com.jledger.finance.service.wallet.impl.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jledger.finance.domain.entity.*;
import com.jledger.finance.domain.enums.*;
import com.jledger.finance.exception.*;
import com.jledger.finance.repository.ledger.AccountRepository;
import com.jledger.finance.repository.ledger.LedgerEntryRepository;
import com.jledger.finance.repository.system.IntegrationOutboxRepository;
import com.jledger.finance.repository.transaction.TransactionRepository;
import com.jledger.finance.repository.wallet.LinkedBankAccountRepository;
import com.jledger.finance.repository.wallet.WalletRepository;
import com.jledger.finance.service.compliance.SystemService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("WalletService Unit Tests")
class WalletServiceTest {

    @Mock
    private WalletRepository walletRepository;

    @Mock
    private TransactionRepository transactionRepository;

    @Mock
    private LinkedBankAccountRepository linkedBankAccountRepository;

    @Mock
    private IntegrationOutboxRepository integrationOutboxRepository;

    @Mock
    private RedisTemplate<String, Object> redisTemplate;

    @Mock
    private ValueOperations<String, Object> valueOperations;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private AccountRepository accountRepository;

    @Mock
    private LedgerEntryRepository ledgerEntryRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private SystemService systemService;

    private WalletService walletService;

    private static final String USER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String RECIPIENT_USER_ID = "22222222-2222-2222-2222-222222222222";
    private static final String SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000000";
    private static final Long WALLET_ID = 5005L;

    @BeforeEach
    void setUp() {
        // Standard lenient mock for Redis Template's opsForValue()
        lenient().doReturn(valueOperations).when(redisTemplate).opsForValue();

        WalletCommonService walletCommonService = new WalletCommonService(
                accountRepository,
                ledgerEntryRepository,
                integrationOutboxRepository,
                jdbcTemplate,
                objectMapper
        );
        WalletCacheService walletCacheService = new WalletCacheService(redisTemplate);
        LinkedBankAccountService linkedBankAccountService = new LinkedBankAccountService(linkedBankAccountRepository);

        WalletQueryService walletQueryService = new WalletQueryService(
                walletRepository,
                transactionRepository,
                walletCommonService,
                redisTemplate,
                objectMapper
        );

        JLedgerProperties jLedgerProperties = new JLedgerProperties();

        WalletAdminService walletAdminService = new WalletAdminService(
                walletRepository,
                transactionRepository,
                accountRepository,
                ledgerEntryRepository,
                walletCacheService,
                walletCommonService,
                linkedBankAccountService,
                objectMapper,
                jLedgerProperties
        );

        TopUpService topUpService = new TopUpService(
                walletRepository,
                transactionRepository,
                accountRepository,
                ledgerEntryRepository,
                linkedBankAccountService,
                walletCacheService,
                walletCommonService,
                jLedgerProperties,
                objectMapper
        );

        P2PTransferService p2pTransferService = new P2PTransferService(
                walletRepository,
                transactionRepository,
                accountRepository,
                ledgerEntryRepository,
                jdbcTemplate,
                systemService,
                objectMapper,
                walletCacheService,
                walletCommonService,
                jLedgerProperties
        );

        walletService = new WalletServiceImpl(
                walletQueryService,
                walletAdminService,
                linkedBankAccountService,
                topUpService,
                p2pTransferService
        );
    }

    @Nested
    @DisplayName("createWallet Method Tests")
    class CreateWalletTests {

        @Test
        @DisplayName("Should successfully create a wallet when it does not exist")
        void shouldCreateWalletSuccessfully() {
            // Arrange
            when(walletRepository.existsByUserId(USER_ID)).thenReturn(false);
            
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(BigDecimal.ZERO);
            wallet.setIsActive(true);
            wallet.setCurrency("THB");

            when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
            when(linkedBankAccountRepository.existsByUserId(USER_ID)).thenReturn(true);

            // Act
            Wallet result = walletService.createWallet(USER_ID, "THB");

            // Assert
            assertThat(result).isNotNull();
            assertThat(result.getUserId()).isEqualTo(USER_ID);
            assertThat(result.getBalance()).isEqualTo(BigDecimal.ZERO);
            verify(walletRepository).save(any(Wallet.class));
        }

        @Test
        @DisplayName("Should throw ConflictException when wallet already exists")
        void shouldThrowConflictWhenWalletExists() {
            // Arrange
            when(walletRepository.existsByUserId(USER_ID)).thenReturn(true);

            // Act & Assert
            assertThatThrownBy(() -> walletService.createWallet(USER_ID, "THB"))
                    .isInstanceOf(ConflictException.class)
                    .hasMessageContaining("Wallet already exists for user");
        }
    }

    @Nested
    @DisplayName("getWallet Method Tests")
    class GetWalletTests {

        @Test
        @DisplayName("Should return wallet from cache (Redis hit)")
        void shouldReturnWalletFromCache() {
            // Arrange
            Wallet cachedWallet = new Wallet();
            cachedWallet.setId(WALLET_ID);
            cachedWallet.setUserId(USER_ID);
            cachedWallet.setCurrency("THB");

            when(valueOperations.get("wallet:" + USER_ID)).thenReturn(cachedWallet);

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));

            // Act
            Optional<Wallet> result = walletService.getWallet(USER_ID);

            // Assert
            assertThat(result).isPresent();
            assertThat(result.get().getAccountId()).isEqualTo(userAccount.getId());
            verify(walletRepository, never()).findByUserId(anyString());
        }

        @Test
        @DisplayName("Should fetch wallet from DB and update cache (Redis miss)")
        void shouldFetchFromDbOnCacheMiss() {
            // Arrange
            Wallet dbWallet = new Wallet();
            dbWallet.setId(WALLET_ID);
            dbWallet.setUserId(USER_ID);
            dbWallet.setCurrency("THB");

            when(valueOperations.get("wallet:" + USER_ID)).thenReturn(null);
            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(dbWallet));

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));

            // Act
            Optional<Wallet> result = walletService.getWallet(USER_ID);

            // Assert
            assertThat(result).isPresent();
            assertThat(result.get().getUserId()).isEqualTo(USER_ID);
            verify(walletRepository).findByUserId(USER_ID);
            verify(valueOperations).set(eq("wallet:" + USER_ID), eq(dbWallet), eq(5L), eq(TimeUnit.MINUTES));
        }
    }

    @Nested
    @DisplayName("updateBalance Method Tests")
    class UpdateBalanceTests {

        @Test
        @DisplayName("Should successfully credit a wallet balance")
        void shouldCreditBalanceSuccessfully() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("100.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(walletRepository.save(any(Wallet.class))).thenAnswer(invocation -> invocation.getArgument(0));

            // Act
            Wallet result = walletService.updateBalance(USER_ID, new BigDecimal("50.0000"));

            // Assert
            assertThat(result.getBalance()).isEqualByComparingTo("150.0000");
            verify(walletRepository).save(wallet);
        }

        @Test
        @DisplayName("Should successfully debit a wallet balance")
        void shouldDebitBalanceSuccessfully() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("100.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(walletRepository.save(any(Wallet.class))).thenAnswer(invocation -> invocation.getArgument(0));

            // Act
            Wallet result = walletService.updateBalance(USER_ID, new BigDecimal("-30.0000"));

            // Assert
            assertThat(result.getBalance()).isEqualByComparingTo("70.0000");
            verify(walletRepository).save(wallet);
        }

        @Test
        @DisplayName("Should throw IllegalArgumentException if wallet is inactive")
        void shouldThrowIfInactive() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setStatus(WalletStatus.INACTIVE);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));

            // Act & Assert
            assertThatThrownBy(() -> walletService.updateBalance(USER_ID, new BigDecimal("50.0000")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Wallet is inactive");
        }

        @Test
        @DisplayName("Should throw IllegalArgumentException if debit results in insufficient balance")
        void shouldThrowIfInsufficientBalance() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("20.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));

            // Act & Assert
            assertThatThrownBy(() -> walletService.updateBalance(USER_ID, new BigDecimal("-50.0000")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Insufficient balance");
        }
    }

    @Nested
    @DisplayName("validateTransaction Method Tests")
    class ValidateTransactionTests {

        @Test
        @DisplayName("Should return true for valid amount and balance")
        void shouldReturnTrueForValidTransaction() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setUserId(USER_ID);
            wallet.setCurrency("THB");
            wallet.setBalance(new BigDecimal("1000.0000"));
            when(valueOperations.get("wallet:" + USER_ID)).thenReturn(wallet);

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));

            // Act
            boolean result = walletService.validateTransaction(USER_ID, new BigDecimal("200.0000"));

            // Assert
            assertThat(result).isTrue();
        }

        @Test
        @DisplayName("Should throw IllegalArgumentException if amount exceeds single transaction limit")
        void shouldThrowIfExceedsLimit() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setUserId(USER_ID);
            wallet.setCurrency("THB");
            wallet.setBalance(new BigDecimal("100000.0000"));
            when(valueOperations.get("wallet:" + USER_ID)).thenReturn(wallet);

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));

            // Act & Assert
            assertThatThrownBy(() -> walletService.validateTransaction(USER_ID, new BigDecimal("60000.0000")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Transaction amount exceeds limit");
        }
    }

    @Nested
    @DisplayName("adjustBalanceById Method Tests")
    class AdjustBalanceByIdTests {

        @Test
        @DisplayName("Should successfully adjust wallet and update double-entry ledger accounts")
        void shouldAdjustBalanceAndApplyDoubleEntry() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("100.0000"));
            wallet.setCurrency("THB");

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            userAccount.setBalance(new BigDecimal("100.0000"));

            Account systemAccount = new Account();
            systemAccount.setId(UUID.fromString(SYSTEM_ACCOUNT_ID));
            systemAccount.setBalance(new BigDecimal("50000.0000"));

            when(walletRepository.findById(WALLET_ID)).thenReturn(Optional.of(wallet));
            when(walletRepository.save(any(Wallet.class))).thenAnswer(invocation -> invocation.getArgument(0));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));
            when(accountRepository.findByIdForUpdate(UUID.fromString(SYSTEM_ACCOUNT_ID)))
                    .thenReturn(Optional.of(systemAccount));

            // Act
            Wallet result = walletService.adjustBalanceById(WALLET_ID, new BigDecimal("50.0000"), "Compensation");

            // Assert
            assertThat(result.getBalance()).isEqualByComparingTo("150.0000");
            assertThat(userAccount.getBalance()).isEqualByComparingTo("150.0000");
            assertThat(systemAccount.getBalance()).isEqualByComparingTo("50050.0000"); // Assets sweeps
            verify(accountRepository).save(userAccount);
            verify(accountRepository).save(systemAccount);
            verify(ledgerEntryRepository).save(any(LedgerEntry.class));
            verify(transactionRepository).save(any(Transaction.class));
        }
    }

    @Nested
    @DisplayName("topUpBank Method Tests")
    class TopUpBankTests {

        @Test
        @DisplayName("Should successfully top up from verified linked bank account")
        void shouldTopUpFromVerifiedBank() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("10.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);
            wallet.setCurrency("THB");

            LinkedBankAccount bankAccount = new LinkedBankAccount();
            bankAccount.setId(7007L);
            bankAccount.setIsVerified(true);
            bankAccount.setBankName("SCB");
            bankAccount.setAccountNumber("123456");

            Account systemAccount = new Account();
            systemAccount.setId(UUID.fromString(SYSTEM_ACCOUNT_ID));
            systemAccount.setBalance(new BigDecimal("500.0000"));

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            userAccount.setBalance(new BigDecimal("10.0000"));

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(linkedBankAccountRepository.findByIdAndUserId(7007L, USER_ID))
                    .thenReturn(Optional.of(bankAccount));
            when(accountRepository.findByIdForUpdate(UUID.fromString(SYSTEM_ACCOUNT_ID)))
                    .thenReturn(Optional.of(systemAccount));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));
            when(walletRepository.save(any(Wallet.class))).thenAnswer(invocation -> invocation.getArgument(0));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

            // Act
            Transaction tx = walletService.topUpBank(USER_ID, new BigDecimal("100.0000"), 7007L);

            // Assert
            assertThat(tx).isNotNull();
            assertThat(wallet.getBalance()).isEqualByComparingTo("110.0000");
            assertThat(systemAccount.getBalance()).isEqualByComparingTo("600.0000");
            verify(ledgerEntryRepository, times(2)).save(any(LedgerEntry.class)); // Debit SCB, Credit User
            verify(transactionRepository).save(any(Transaction.class));
        }

        @Test
        @DisplayName("Should throw IllegalArgumentException if bank account is not verified")
        void shouldThrowIfBankNotVerified() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setStatus(WalletStatus.ACTIVE);

            LinkedBankAccount bankAccount = new LinkedBankAccount();
            bankAccount.setId(7007L);
            bankAccount.setIsVerified(false);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(linkedBankAccountRepository.findByIdAndUserId(7007L, USER_ID))
                    .thenReturn(Optional.of(bankAccount));

            // Act & Assert
            assertThatThrownBy(() -> walletService.topUpBank(USER_ID, new BigDecimal("100.0000"), 7007L))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Bank account is not verified");
        }
    }

    @Nested
    @DisplayName("creditTopUpFromExternal Method Tests")
    class CreditTopUpFromExternalTests {

        @Test
        @DisplayName("Should return existing transaction if already processed (Idempotency soft check)")
        void shouldReturnExistingTransactionForIdempotency() {
            // Arrange
            Transaction existingTx = new Transaction();
            existingTx.setTransactionId("TXN12345");
            existingTx.setReferenceId("stripe-ref-999");

            when(transactionRepository.findByReferenceId("stripe-ref-999"))
                    .thenReturn(Optional.of(existingTx));

            // Act
            Transaction result = walletService.creditTopUpFromExternal(
                    USER_ID, new BigDecimal("500.0000"), "THB", "stripe-ref-999", "STRIPE", "{}"
            );

            // Assert
            assertThat(result).isNotNull();
            assertThat(result.getTransactionId()).isEqualTo("TXN12345");
            verify(walletRepository, never()).findByUserIdForUpdate(anyString());
        }

        @Test
        @DisplayName("Should process external credit and save transaction details when first requested")
        void shouldProcessNewExternalTopUp() {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("50.0000"));
            wallet.setCurrency("THB");
            wallet.setStatus(WalletStatus.ACTIVE);

            Account systemAccount = new Account();
            systemAccount.setId(UUID.fromString(SYSTEM_ACCOUNT_ID));
            systemAccount.setBalance(new BigDecimal("1000.0000"));

            Account userAccount = new Account();
            userAccount.setId(UUID.fromString("33333333-3333-3333-3333-333333333333"));
            userAccount.setBalance(new BigDecimal("50.0000"));

            when(transactionRepository.findByReferenceId("stripe-ref-999")).thenReturn(Optional.empty());
            when(accountRepository.findByIdForUpdate(UUID.fromString(SYSTEM_ACCOUNT_ID)))
                    .thenReturn(Optional.of(systemAccount));
            when(walletRepository.findByUserIdForUpdate(USER_ID)).thenReturn(Optional.of(wallet));
            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));
            when(walletRepository.save(any(Wallet.class))).thenAnswer(invocation -> invocation.getArgument(0));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

            // Act
            Transaction result = walletService.creditTopUpFromExternal(
                    USER_ID, new BigDecimal("500.0000"), "THB", "stripe-ref-999", "STRIPE", "{}"
            );

            // Assert
            assertThat(result).isNotNull();
            assertThat(wallet.getBalance()).isEqualByComparingTo("550.0000");
            assertThat(systemAccount.getBalance()).isEqualByComparingTo("1500.0000");
            assertThat(userAccount.getBalance()).isEqualByComparingTo("550.0000");
            verify(ledgerEntryRepository, times(2)).save(any(LedgerEntry.class));
            verify(transactionRepository).save(any(Transaction.class));
        }
    }

    @Nested
    @DisplayName("previewTransferByPhone Method Tests")
    class PreviewTransferByPhoneTests {

        @Test
        @DisplayName("Should return preview map with 0 fee and correct total debit calculation")
        void shouldReturnCorrectPreview() {
            // Arrange
            Wallet fromWallet = new Wallet();
            fromWallet.setId(WALLET_ID);
            fromWallet.setUserId(USER_ID);
            fromWallet.setBalance(new BigDecimal("500.0000"));
            fromWallet.setStatus(WalletStatus.ACTIVE);
            fromWallet.setCurrency("THB");

            Wallet toWallet = new Wallet();
            toWallet.setId(6006L);
            toWallet.setUserId(RECIPIENT_USER_ID);
            toWallet.setStatus(WalletStatus.ACTIVE);

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(fromWallet));
            
            // Mock phone lookup
            String recipientPhone = "0812345678";
            when(jdbcTemplate.query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), anyString()))
                    .thenReturn(Collections.singletonList(RECIPIENT_USER_ID));
            when(walletRepository.findByUserId(RECIPIENT_USER_ID)).thenReturn(Optional.of(toWallet));

            // Act
            Map<String, Object> preview = walletService.previewTransferByPhone(USER_ID, recipientPhone, new BigDecimal("100.0000"));

            // Assert
            assertThat(preview).isNotNull();
            assertThat(preview.get("amount")).isEqualTo(new BigDecimal("100.0000"));
            assertThat(preview.get("fee")).isEqualTo(BigDecimal.ZERO.setScale(4));
            assertThat(preview.get("totalDebit")).isEqualTo(new BigDecimal("100.0000"));
            assertThat(preview.get("currency")).isEqualTo("THB");
        }
    }

    @Nested
    @DisplayName("Bill Payment & Banker's Rounding Multi-leg Ledger Tests")
    class BillPaymentMultiLegTests {

        private Account userAccount;
        private Account systemAccount;
        private Account feeAccount;
        private Account roundingAccount;

        @BeforeEach
        void initAccounts() {
            userAccount = Account.builder()
                    .id(UUID.randomUUID())
                    .userId(UUID.fromString(USER_ID))
                    .accountName("User Ledger Account")
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
        @DisplayName("payUtilityBill should apply Banker's Rounding and record multi-leg ledger entries")
        void shouldPayUtilityBillWithBankersRoundingAndMultiLeg() throws Exception {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("1000.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);
            wallet.setCurrency("THB");

            SystemSettings settings = new SystemSettings();
            settings.setBillPaymentFeeFixed(new BigDecimal("5.0000"));
            settings.setBillPaymentFeePercentage(new BigDecimal("0.5000")); // 0.5%

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(systemService.getSystemSettings()).thenReturn(settings);
            when(walletRepository.save(any(Wallet.class))).thenAnswer(inv -> inv.getArgument(0));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(objectMapper.writeValueAsString(any())).thenReturn("{}");

            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));
            when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000000")))
                    .thenReturn(Optional.of(systemAccount));
            when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000001")))
                    .thenReturn(Optional.of(feeAccount));
            lenient().when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000002")))
                    .thenReturn(Optional.of(roundingAccount));

            // Act: Pay 100 THB bill -> 0.5% is 0.5000 THB, fixed 5.0000 THB -> total fee = 5.5000 THB
            Transaction txn = walletService.payUtilityBill(USER_ID, "MEA", "ACC-12345", new BigDecimal("100.0000"));

            // Assert
            assertThat(txn).isNotNull();
            assertThat(txn.getType()).isEqualTo(TransactionType.BILL_PAYMENT);
            assertThat(txn.getAmount()).isEqualByComparingTo("100.0000");
            assertThat(wallet.getBalance()).isEqualByComparingTo("894.5000"); // 1000 - 105.5000

            // Multi-leg ledger verify: 3 legs (Debit User: 105.50, Credit System: 100.00, Credit Fee: 5.50)
            ArgumentCaptor<LedgerEntry> captor = ArgumentCaptor.forClass(LedgerEntry.class);
            verify(ledgerEntryRepository, atLeast(3)).save(captor.capture());

            List<LedgerEntry> entries = captor.getAllValues();
            BigDecimal debitSum = entries.stream()
                    .filter(e -> "DEBIT".equals(e.getEntryType()))
                    .map(LedgerEntry::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal creditSum = entries.stream()
                    .filter(e -> "CREDIT".equals(e.getEntryType()))
                    .map(LedgerEntry::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

            assertThat(debitSum).isEqualByComparingTo(creditSum);
            assertThat(debitSum).isEqualByComparingTo("105.5000");
        }

        @Test
        @DisplayName("payCreditCardBill should apply Banker's Rounding and record multi-leg ledger entries")
        void shouldPayCreditCardBillWithBankersRoundingAndMultiLeg() throws Exception {
            // Arrange
            Wallet wallet = new Wallet();
            wallet.setId(WALLET_ID);
            wallet.setUserId(USER_ID);
            wallet.setBalance(new BigDecimal("5000.0000"));
            wallet.setStatus(WalletStatus.ACTIVE);
            wallet.setCurrency("THB");

            SystemSettings settings = new SystemSettings();
            settings.setBillPaymentFeeFixed(new BigDecimal("10.0000"));
            settings.setBillPaymentFeePercentage(new BigDecimal("0.3500")); // 0.35%

            when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));
            when(systemService.getSystemSettings()).thenReturn(settings);
            when(walletRepository.save(any(Wallet.class))).thenAnswer(inv -> inv.getArgument(0));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(objectMapper.writeValueAsString(any())).thenReturn("{}");

            when(accountRepository.findByUserId(UUID.fromString(USER_ID)))
                    .thenReturn(Collections.singletonList(userAccount));
            when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000000")))
                    .thenReturn(Optional.of(systemAccount));
            when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000001")))
                    .thenReturn(Optional.of(feeAccount));
            lenient().when(accountRepository.findById(UUID.fromString("00000000-0000-0000-0000-000000000002")))
                    .thenReturn(Optional.of(roundingAccount));

            // Act: Pay 1000 THB credit card -> 0.35% is 3.5000 THB, fixed 10.0000 THB -> total fee = 13.5000 THB
            Transaction txn = walletService.payCreditCardBill(USER_ID, "4111222233334444", new BigDecimal("1000.0000"));

            // Assert
            assertThat(txn).isNotNull();
            assertThat(txn.getType()).isEqualTo(TransactionType.BILL_PAYMENT);
            assertThat(txn.getAmount()).isEqualByComparingTo("1000.0000");
            assertThat(wallet.getBalance()).isEqualByComparingTo("3986.5000"); // 5000 - 1013.5000

            // Multi-leg ledger verify: ΣDebit == ΣCredit
            ArgumentCaptor<LedgerEntry> captor = ArgumentCaptor.forClass(LedgerEntry.class);
            verify(ledgerEntryRepository, atLeast(3)).save(captor.capture());

            List<LedgerEntry> entries = captor.getAllValues();
            BigDecimal debitSum = entries.stream()
                    .filter(e -> "DEBIT".equals(e.getEntryType()))
                    .map(LedgerEntry::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal creditSum = entries.stream()
                    .filter(e -> "CREDIT".equals(e.getEntryType()))
                    .map(LedgerEntry::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

            assertThat(debitSum).isEqualByComparingTo(creditSum);
            assertThat(debitSum).isEqualByComparingTo("1013.5000");
        }
    }
}
