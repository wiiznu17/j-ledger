import { executeTransfer } from '../src/app/actions/transfer';
import { transactionRequester } from '@/lib/requesters';
import { ApiError } from '@/lib/api-client';

jest.mock('@/lib/requesters', () => ({
  transactionRequester: {
    transfer: jest.fn(),
  },
}));

describe('Transfer Server Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    if (!global.crypto) {
      Object.defineProperty(global, 'crypto', {
        value: {
          randomUUID: () => 'mocked-uuid-1234',
        },
      });
    } else if (!global.crypto.randomUUID) {
      global.crypto.randomUUID = () => 'a0000000-0000-0000-0000-000000001234';
    }
  });

  it('should rigidly return error if missing fields exist', async () => {
    const formData = new FormData();
    const result = await executeTransfer(formData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing required fields');
  });

  it('should successfully call transactionRequester.transfer and explicitly include Idempotency-Key header', async () => {
    (transactionRequester.transfer as jest.Mock).mockResolvedValueOnce({
      id: 'tx-999',
      status: 'COMPLETED',
    });

    const formData = new FormData();
    formData.append('sourceAccountId', 'acc-val-1');
    formData.append('destinationAccountId', 'acc-val-2');
    formData.append('amount', '50.0');

    const result = await executeTransfer(formData);

    expect(transactionRequester.transfer).toHaveBeenCalledTimes(1);

    const callArgs = (transactionRequester.transfer as jest.Mock).mock.calls[0];
    const payload = callArgs[0];
    const options = callArgs[1];

    expect(options.headers).toHaveProperty('Idempotency-Key');

    expect(payload).toMatchObject({
      fromAccountId: 'acc-val-1',
      toAccountId: 'acc-val-2',
      amount: '50.0',
      currency: 'THB',
    });

    if (result.success && result.data) {
      expect(result.data.id).toBe('tx-999');
    } else {
      throw new Error('Transfer should have succeeded');
    }
  });

  it('should defensively catch API failure strings properly', async () => {
    (transactionRequester.transfer as jest.Mock).mockRejectedValueOnce(
      new ApiError(500, 'System busy, please try again.'),
    );

    const formData = new FormData();
    formData.append('sourceAccountId', 'ac-1');
    formData.append('destinationAccountId', 'ac-2');
    formData.append('amount', '22.0');

    const result = await executeTransfer(formData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('System busy, please try again.');
  });
});
