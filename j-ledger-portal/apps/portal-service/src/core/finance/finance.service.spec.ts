import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { FinanceService } from './finance.service';
import { createMockConfigService, createMockHttpService } from '../../__tests__/test-utils';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('FinanceService', () => {
  let service: FinanceService;
  let httpService: any;
  let configService: any;

  beforeEach(async () => {
    httpService = createMockHttpService();
    configService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWallet', () => {
    it('should call API post and return response data', async () => {
      const mockResponse = { id: 1, userId: 'user-123', walletId: 'W1', balance: 0 };
      httpService.axiosRef.post.mockResolvedValue({ data: mockResponse });

      const result = await service.createWallet('user-123', 'THB');

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/finance/wallets/create',
        { userId: 'user-123', currency: 'THB' },
        expect.any(Object),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should map Java "Insufficient balance" error to Thai error message', async () => {
      const errorResponse = {
        response: {
          status: HttpStatus.BAD_REQUEST,
          data: { message: 'Insufficient balance in customer account' },
        },
      };
      httpService.axiosRef.post.mockRejectedValue(errorResponse);

      await expect(service.createWallet('user-123', 'THB')).rejects.toThrow(
        new HttpException({ message: 'ยอดเงินในบัญชีไม่เพียงพอ' }, HttpStatus.BAD_REQUEST),
      );
    });

    it('should map Java "Transaction conflict" error to duplicate transaction error message', async () => {
      const errorResponse = {
        response: {
          status: HttpStatus.CONFLICT,
          data: { message: 'Transaction conflict occurred' },
        },
      };
      httpService.axiosRef.post.mockRejectedValue(errorResponse);

      await expect(service.createWallet('user-123', 'THB')).rejects.toThrow(
        new HttpException({ message: 'รายการนี้ถูกประมวลผลไปแล้ว' }, HttpStatus.CONFLICT),
      );
    });

    it('should map Java "Lock wait timeout" error to lock timeout error message', async () => {
      const errorResponse = {
        response: {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          data: { message: 'Lock wait timeout exceeded' },
        },
      };
      httpService.axiosRef.post.mockRejectedValue(errorResponse);

      await expect(service.createWallet('user-123', 'THB')).rejects.toThrow(
        new HttpException({ message: 'ระบบไม่ว่างชั่วคราว กรุณาลองใหม่อีกครั้ง (Lock Timeout)' }, HttpStatus.SERVICE_UNAVAILABLE),
      );
    });
  });

  describe('createAccount', () => {
    it('should call API post to create business/ledger account', async () => {
      const mockResponse = { id: 'acc-123' };
      httpService.axiosRef.post.mockResolvedValue({ data: mockResponse });

      const result = await service.createAccount('owner-1', 'Burger Joint - Available', 'THB', 'AVAILABLE');

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/v1/accounts',
        {
          user_id: 'owner-1',
          account_name: 'Burger Joint - Available',
          currency: 'THB',
          account_type: 'AVAILABLE',
        },
        expect.any(Object),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getSystemSettings', () => {
    it('should call API get and return system settings', async () => {
      const mockSettings = { merchantFeeRate: 0.03, vatRate: 0.07 };
      httpService.axiosRef.get.mockResolvedValue({ data: mockSettings });

      const result = await service.getSystemSettings();

      expect(httpService.axiosRef.get).toHaveBeenCalledWith(
        'http://localhost:8081/api/v1/system/settings',
        expect.any(Object),
      );
      expect(result).toEqual(mockSettings);
    });
  });

  describe('updateSystemSettings', () => {
    it('should call API put to update settings', async () => {
      const mockPayload = { merchantFeeRate: 0.02 };
      httpService.axiosRef.put.mockResolvedValue({ data: { success: true } });

      const result = await service.updateSystemSettings(mockPayload);

      expect(httpService.axiosRef.put).toHaveBeenCalledWith(
        'http://localhost:8081/api/v1/system/settings',
        mockPayload,
        expect.any(Object),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('getWallet', () => {
    it('should return null when wallet is not found (404 status)', async () => {
      const errorResponse = {
        response: {
          status: HttpStatus.NOT_FOUND,
          data: { message: 'Wallet not found' },
        },
      };
      httpService.axiosRef.get.mockRejectedValue(errorResponse);

      const result = await service.getWallet('user-non-existent');

      expect(result).toBeNull();
    });

    it('should return wallet data when found', async () => {
      const mockWallet = { id: 1, userId: 'user-1', walletId: 'W1', balance: 100 };
      httpService.axiosRef.get.mockResolvedValue({ data: mockWallet });

      const result = await service.getWallet('user-1');

      expect(result).toEqual(mockWallet);
    });
  });

  describe('topUp (2-step dynamic topup process)', () => {
    it('should successfully perform top-up by checking wallet, posting payments intent, and submitting webhook confirmation', async () => {
      const mockWallet = { id: 1, userId: 'user-1', walletId: 'W1', accountId: 'acc-1', balance: 500 };
      httpService.axiosRef.get.mockResolvedValue({ data: mockWallet });
      httpService.axiosRef.post.mockResolvedValue({ data: { success: true } });

      const result = await service.topUp('user-1', 100, 1);

      expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8081/api/finance/payments',
        expect.objectContaining({
          accountId: 'acc-1',
          amount: '100',
          type: 'TOPUP',
        }),
        expect.any(Object),
      );

      expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8081/api/finance/webhooks',
        expect.objectContaining({
          status: 'SUCCESS',
          signature: expect.any(String),
        }),
        expect.any(Object),
      );

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(600);
    });
  });

  describe('transferByPhone', () => {
    it('should post payload to transfer/phone endpoint', async () => {
      const mockPayload = { recipientPhone: '0812345678', amount: '100.00', note: 'test note', idempotencyKey: 'key-1' };
      httpService.axiosRef.post.mockResolvedValue({ data: { transactionId: 'TX1' } });

      const result = await service.transferByPhone('user-1', mockPayload);

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/finance/wallets/user-1/transfer/phone',
        mockPayload,
        expect.any(Object),
      );
      expect(result).toEqual({ transactionId: 'TX1' });
    });
  });

  describe('performTransfer', () => {
    it('should perform a P2P transfer if type is not MERCHANT_PAYMENT', async () => {
      const payload = {
        fromAccountId: 'A1',
        toAccountId: 'A2',
        amount: '200.00',
        idempotencyKey: 'idem-123',
        note: 'transfer note',
      };
      const mockResponse = { id: 1, transactionId: 'T1', status: 'SUCCESS' };
      httpService.axiosRef.post.mockResolvedValue({ data: mockResponse });

      const result = await service.performTransfer(payload);

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/finance/transactions/p2p-transfer',
        {
          idempotencyKey: 'idem-123',
          fromAccountId: 'A1',
          toAccountId: 'A2',
          amount: '200.00',
          currency: 'THB',
          metadata: undefined,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'idem-123',
          }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should perform a MERCHANT_PAYMENT transfer if type is MERCHANT_PAYMENT', async () => {
      const payload = {
        fromAccountId: 'W_CUST',
        toAccountId: 'W_MERCH',
        amount: '100.00',
        idempotencyKey: 'idem-456',
        type: 'MERCHANT_PAYMENT',
        currency: 'THB',
      };
      const mockResponse = { id: 2, transactionId: 'T2', status: 'SUCCESS' };
      httpService.axiosRef.post.mockResolvedValue({ data: mockResponse });

      const result = await service.performTransfer(payload);

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/finance/transactions/merchant-pay',
        {
          fromWalletId: 'W_CUST',
          toWalletId: 'W_MERCH',
          amount: '100.00',
          currency: 'THB',
          metadata: undefined,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'idem-456',
          }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('performMerchantMultiPay', () => {
    it('should execute atomic multi-leg merchant pay in one POST', async () => {
      const payload = {
        fromWalletId: 'W_FROM',
        idempotencyKey: 'idem-multi',
        legs: [
          { toWalletId: 'W_TO1', amount: '93.00', note: 'Net' },
          { toWalletId: 'W_TO2', amount: '7.00', note: 'Vat' },
        ],
      };
      const mockResponse = { transactionId: 'TXN-MULTI-123' };
      httpService.axiosRef.post.mockResolvedValue({ data: mockResponse });

      const result = await service.performMerchantMultiPay(payload);

      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        'http://localhost:8081/api/finance/transactions/merchant-pay-atomic',
        {
          fromWalletId: 'W_FROM',
          currency: 'THB',
          legs: [
            { toWalletId: 'W_TO1', amount: '93.00', note: 'Net' },
            { toWalletId: 'W_TO2', amount: '7.00', note: 'Vat' },
          ],
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'idem-multi',
          }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
