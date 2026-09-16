import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ArrowRight,
  ShieldCheck,
  Wallet,
  UserCircle,
  CalendarClock,
} from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { useAuthStore } from '../../store/auth';
import { BiometricAuth } from '../../components/auth/BiometricAuth';
import { PINVerification } from '../../components/auth/PINVerification';
import { ErrorRecovery } from '../../components/error/ErrorRecovery';
import * as Location from 'expo-location';
import {
  isBiometricAvailable,
  isBiometricEnrolled,
} from '../../lib/biometric-auth';
import {
  TransferError,
  logTransaction,
  parseBackendError,
  getRecoveryPath,
} from '../../lib/error-handling';
import { NotificationService } from '../../lib/notification-service';
import { useScreenCaptureProtection } from '@/hooks/useScreenCaptureProtection';
import { api } from '@/lib/axios';
import { MerchantService } from '@/lib/merchant-service';
import { TransactionReviewCard } from '@/components/transaction/TransactionReviewCard';
import { StickyActionArea } from '@/components/transaction/StickyActionArea';
import { ProcessingPortal } from '@/components/transaction/ProcessingPortal';
import { Alert } from 'react-native';

const { width } = Dimensions.get('window');

export default function ReviewTransferScreen() {
  // Prevent screen capture on sensitive transaction review
  useScreenCaptureProtection();

  const router = useRouter();
  const {
    merchantId,
    paymentId,
    recipient,
    amount,
    note,
    merchantName,
    recipientName,
    recipientMasked,
    isScheduled,
    frequency,
    scheduledDate,
  } = useLocalSearchParams<{
    merchantId?: string;
    paymentId?: string;
    recipient?: string;
    amount: string;
    note?: string;
    merchantName?: string;
    recipientName?: string;
    recipientMasked?: string;
    isScheduled?: string;
    frequency?: string;
    scheduledDate?: string;
  }>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Error handling
  const [error, setError] = useState<TransferError | null>(null);

  // Generate idempotency key once per screen session (prevents double charging on retry)
  const [idempotencyKey] = useState(
    () => `p2p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );

  // Authentication states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showBiometric, setShowBiometric] = useState(false);
  const [showPIN, setShowPIN] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const biometricEnabled = useAuthStore((state) => state.biometricEnabled);

  const transferAmount = parseFloat(amount as string) || 0;
  const fee = 0;
  const totalAmount = transferAmount + fee;

  // Check biometric availability on mount
  useEffect(() => {
    const checkBiometric = async () => {
      const available = await isBiometricAvailable();
      const enrolled = await isBiometricEnrolled();
      setBiometricAvailable(available && enrolled);
    };
    checkBiometric();
  }, []);

  const handleConfirm = async () => {
    if (isProcessing || isConfirming) return;

    // For security, always require authentication
    // Check if authentication is required
    if (biometricAvailable && biometricEnabled) {
      // Show biometric first
      setIsConfirming(true);
      setShowBiometric(true);
      return;
    }

    // Always require PIN for security
    setIsConfirming(true);
    setShowPIN(true);
  };

  const handleBiometricSuccess = () => {
    setShowBiometric(false);
    setIsAuthenticated(true);
    setIsConfirming(false);
    performTransfer();
  };

  const handleBiometricFailure = (error: string) => {
    // Fallback to PIN after 3 failed biometric attempts
    setShowBiometric(false);
    setShowPIN(true);
  };

  const handlePINSuccess = () => {
    setShowPIN(false);
    setIsAuthenticated(true);
    setIsConfirming(false);
    performTransfer();
  };

  const handlePINFailure = (error: string) => {
    // Close authentication modal on PIN failure
    setShowPIN(false);
    setIsConfirming(false);
  };

  const handleAuthCancel = () => {
    setShowBiometric(false);
    setShowPIN(false);
    setIsConfirming(false);
  };

  const performTransfer = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      let locationStr = 'Bangkok, Thailand';
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const rev = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          if (rev && rev[0]) {
            const r = rev[0];
            const city = r.region || r.subregion || r.city || 'Bangkok';
            const country = r.country || 'Thailand';
            locationStr = `${city}, ${country}`;
          }
        }
      } catch (gpsErr) {
        console.warn(
          '[GPS] Failed to retrieve current location for transaction:',
          gpsErr,
        );
      }

      const formattedNote = `${note || ''} [Loc: ${locationStr}]`.trim();
      let result: any;

      if (isScheduled === 'true') {
        // Scheduled Transfer Flow
        const res = await api.post('/integration/scheduled-transfers', {
          recipientPhone: recipient,
          amount: transferAmount,
          note: formattedNote,
          frequency: frequency,
          startDate: scheduledDate,
        });
        setIsProcessing(false);
        Alert.alert(
          'Success',
          'Your scheduled transfer has been set up successfully.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/profile' as any) }]
        );
        return;
      }

      if (paymentId) {
        // Dynamic QR Payment Flow
        result = await MerchantService.confirmPayment(paymentId);
      } else if (merchantId) {
        // Static QR / Manual Merchant Payment Flow
        result = await MerchantService.confirmManualPayment({
          merchantId,
          amount: transferAmount,
          note: formattedNote,
        });
      } else {
        // P2P Transfer Flow
        const transferRes = await api.post('/integration/p2p/transfer', {
          recipientPhone: recipient,
          amount: transferAmount,
          note: formattedNote,
          idempotencyKey,
        });
        result = transferRes.data;
      }

      setIsProcessing(false);

      // Send success notification
      const recipientDisplay =
        (merchantName as string) ||
        (recipientName as string) ||
        (recipient as string) ||
        'Recipient';
      NotificationService.transferSuccess(recipientDisplay, amount as string);

      router.replace({
        pathname: '/transfer/success',
        params: {
          recipient,
          amount,
          note: formattedNote,
          merchantName:
            merchantName || (merchantId ? recipientName : undefined),
          transactionId: result.transactionId,
          createdAt: result.createdAt || new Date().toISOString(),
          recipientName: result?.recipient?.displayName || recipientName,
          recipientMasked: result?.recipient?.phoneMasked || recipientMasked,
        },
      } as any);
    } catch (err: any) {
      console.error('[Transfer] Error:', err);

      setIsProcessing(false);

      // Parse error response
      const transferError = parseBackendError(err);
      transferError.recoveryAction = 'RETRY';

      // Send error notification
      NotificationService.transferFailed(
        err.message || 'Unknown error occurred',
      );

      // Log failed transfer
      logTransaction({
        id: '',
        timestamp: Date.now(),
        type: 'TRANSFER',
        status: 'FAILURE',
        recipient: recipient as string,
        amount: amount as string,
        error: transferError,
        details: { merchantName, note, errorDetails: err },
      });

      setError(transferError);
    }
  };

  const isButtonDisabled = isProcessing || isConfirming;

  const handleErrorRetry = () => {
    setError(null);
    performTransfer();
  };

  const handleErrorEdit = () => {
    setError(null);
    router.back();
  };

  const handleErrorBack = () => {
    setError(null);
    router.push('/transfer' as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      {/* Header */}
      <View className="px-5 pt-2 pb-4 flex-row items-center justify-between">
        <TouchableOpacity
          onPress={() => !isProcessing && router.back()}
          className="w-10 h-10 rounded-2xl bg-white border border-gray-100 flex items-center justify-center shadow-sm"
        >
          <ChevronLeft size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text className="text-lg font-manrope font-black text-gray-800 tracking-tight">
          Review Transfer
        </Text>
        <View className="w-10" />
      </View>

      {/* เพิ่ม paddingBottom เผื่อพื้นที่ให้ Action Area ลอยอยู่ด้านล่าง */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          className="mt-2"
        >
          {/* Main Review Card */}
          <TransactionReviewCard
            amount={transferAmount}
            toName={
              (merchantName as string) ||
              (recipientName as string) ||
              (recipient as string)
            }
            toType={merchantId || paymentId ? 'merchant' : 'user'}
            transactionType={
              paymentId
                ? 'QR Payment'
                : merchantId
                  ? 'Merchant Payment'
                  : 'Peer-to-Peer'
            }
            fee={fee}
            note={note as string}
          />

          {/* Schedule Details Card */}
          {isScheduled === 'true' && (
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-indigo-50/50 p-5 rounded-3xl border border-indigo-100 flex-row items-center gap-4 shadow-sm mb-4"
            >
              <View className="w-12 h-12 rounded-2xl bg-white items-center justify-center border border-indigo-100 shadow-sm">
                <CalendarClock size={24} color="#6366f1" />
              </View>
              <View className="flex-1">
                <Text className="text-[10px] font-manrope font-black text-indigo-500 uppercase tracking-widest mb-1">
                  Scheduled Transfer
                </Text>
                <Text className="text-xs font-manrope font-bold text-gray-700">
                  {frequency} • Starts {new Date(scheduledDate!).toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}
                </Text>
              </View>
            </MotiView>
          )}

          {/* Trust Banner */}
          <View className="bg-green-50/50 p-5 rounded-2xl border border-green-100/50 flex-row items-center gap-4 shadow-sm mb-4">
            <View className="w-10 h-10 rounded-xl bg-white items-center justify-center border border-green-100">
              <ShieldCheck size={20} color="#22c55e" />
            </View>
            <Text className="text-[10px] font-manrope font-bold text-green-700/80 uppercase tracking-widest flex-1 leading-relaxed">
              Guaranteed by P-wallet Security Standard
            </Text>
          </View>

          {/* Error Display */}
          {error && (
            <ErrorRecovery
              error={error}
              onRetry={handleErrorRetry}
              onEdit={handleErrorEdit}
              onBack={handleErrorBack}
              onDismiss={() => setError(null)}
            />
          )}
        </MotiView>
      </ScrollView>

      {/* Authentication Modal - Outside ScrollView */}
      <AnimatePresence>
        {isConfirming && !error && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white items-center justify-center z-40"
          >
            {showBiometric && biometricAvailable && biometricEnabled && (
              <View className="w-full bg-white rounded-t-[2.5rem] p-6 pt-8">
                <BiometricAuth
                  onSuccess={handleBiometricSuccess}
                  onFailure={handleBiometricFailure}
                  onUsePIN={() => {
                    setShowBiometric(false);
                    setShowPIN(true);
                  }}
                />
              </View>
            )}

            {showPIN && (
              <PINVerification
                onSuccess={handlePINSuccess}
                onFailure={handlePINFailure}
                onCancel={handleAuthCancel}
              />
            )}
          </MotiView>
        )}
      </AnimatePresence>

      {/* Sticky Action Area */}
      <StickyActionArea
        isVisible={true}
        label={isConfirming ? 'Authenticating...' : 'Confirm Transfer'}
        onPress={handleConfirm}
        disabled={isButtonDisabled}
        isLoading={isProcessing}
        isAuthenticating={isConfirming}
      />

      {/* Full Screen Processing Portal */}
      <ProcessingPortal
        isVisible={isProcessing}
        title="Encrypting Transaction"
        subtitle="We're verifying your identities and securing the ledger connection..."
      />
    </SafeAreaView>
  );
}
