import React, { useState, useEffect, useRef } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Info } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';

// Sub-components
import { QRHeader } from '@/components/my-qr/QRHeader';
import { QRCard, QRCardRef } from '@/components/my-qr/QRCard';
import { AmountTriggerButton } from '@/components/my-qr/AmountTriggerButton';
import { QRActionButtons } from '@/components/my-qr/QRActionButtons';
import { QRInfoBanner } from '@/components/my-qr/QRInfoBanner';
import { AmountModal } from '@/components/my-qr/AmountModal';

// Services
import { UserProfileService, UserProfile } from '@/lib/user-service';

// Hooks
import { useScreenCaptureProtection } from '@/hooks/useScreenCaptureProtection';

// Constants
const DEFAULT_AVATAR = require('../../assets/images/logo/logo.png');

export default function MyQrScreen() {
  useScreenCaptureProtection();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [tempAmount, setTempAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const qrCardRef = useRef<QRCardRef>(null);

  // POS / Present-to-Pay States
  const [mode, setMode] = useState<'RECEIVE' | 'PAY'>('RECEIVE');
  const [payToken, setPayToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const profile = await UserProfileService.getProfile();
      console.log('[MyQR] User profile loaded:', profile);
      setUserProfile(profile);
    } catch (error) {
      console.error('Failed to load user profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchToken = async () => {
    try {
      setIsProcessing(true);
      const res = await UserProfileService.getPayToken();
      setPayToken(res.token);
      setExpiresAt(res.expiresAt);
      
      const seconds = Math.max(0, Math.floor((new Date(res.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(seconds);
    } catch (error) {
      console.error('Failed to fetch pay token:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (mode === 'PAY') {
      fetchToken();
    } else {
      setPayToken('');
      setSecondsLeft(0);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'PAY' || !expiresAt) return;

    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(seconds);
      if (seconds <= 0) {
        clearInterval(timer);
        fetchToken(); // Automatically refresh when expired
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [mode, expiresAt]);

  // Convert E.164 phone number to local 10-digit format
  const toLocalPhone = (phone: string): string => {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('66') && digits.length === 11) {
      return `0${digits.slice(2)}`;
    }
    if (digits.startsWith('0') && digits.length === 10) {
      return digits;
    }
    return phone;
  };

  // Get phone number from real user profile (no silent mock fallback)
  const phoneNumber = userProfile?.phoneNumber
    ? toLocalPhone(userProfile.phoneNumber)
    : '';

  // Get user name from profile (English) or kycData (Thai) or fallback to email / account
  const userName = userProfile?.profile?.firstName
    ? `${userProfile.profile.firstName} ${userProfile.profile.lastName || ''}`.trim()
    : userProfile?.kycData?.firstNameTh
      ? `${userProfile.kycData.firstNameTh} ${userProfile.kycData.lastNameTh || ''}`.trim()
      : userProfile?.email || 'My Wallet';

  // สร้างข้อมูลสำหรับ QR Code โดยแนบจำนวนเงินเข้าไปถ้ามีการระบุ
  const qrData = mode === 'PAY'
    ? payToken || 'LOADING...'
    : (amount && parseFloat(amount) > 0
        ? `JLEDGER:${phoneNumber}:${amount}`
        : `JLEDGER:${phoneNumber}`);

  const handleSetAmount = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setAmount(tempAmount);
    setTimeout(() => {
      setIsModalVisible(false);
      setIsProcessing(false);
    }, 400); // จำลองการคำนวณ QR เล็กน้อย
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
        <QRHeader isProcessing={false} setIsProcessing={() => {}} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <QRHeader isProcessing={isProcessing} setIsProcessing={setIsProcessing} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          className="mt-2"
        >
          {/* Segmented Mode Switcher */}
          <View className="flex-row bg-gray-100 p-1.5 rounded-[1.8rem] mb-6 border border-gray-200">
            <TouchableOpacity
              onPress={() => setMode('RECEIVE')}
              className={`flex-1 py-3.5 rounded-[1.5rem] items-center justify-center ${
                mode === 'RECEIVE' ? 'bg-[#f48fb1] shadow-sm' : 'bg-transparent'
              }`}
            >
              <Text
                className={`font-manrope font-black text-[14px] ${
                  mode === 'RECEIVE' ? 'text-white' : 'text-gray-500'
                }`}
              >
                รับเงิน (Receive)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('PAY')}
              className={`flex-1 py-3.5 rounded-[1.5rem] items-center justify-center ${
                mode === 'PAY' ? 'bg-[#f48fb1] shadow-sm' : 'bg-transparent'
              }`}
            >
              <Text
                className={`font-manrope font-black text-[14px] ${
                  mode === 'PAY' ? 'text-white' : 'text-gray-500'
                }`}
              >
                จ่ายหน้าร้าน (Pay POS)
              </Text>
            </TouchableOpacity>
          </View>

          <QRCard
            ref={qrCardRef}
            name={mode === 'PAY' ? 'PAYMENT CODE' : userName}
            phone={mode === 'PAY' ? 'SCAN TO DEBIT' : phoneNumber}
            avatar={DEFAULT_AVATAR}
            qrData={qrData}
            amount={mode === 'PAY' ? '' : amount}
          />

          {mode === 'PAY' && (
            <View className="items-center mt-2 mb-6">
              <Text className="text-gray-500 font-manrope font-semibold text-[14px]">
                Token will refresh in: <Text className="text-pink-500 font-black">{secondsLeft}s</Text>
              </Text>
              <TouchableOpacity
                onPress={fetchToken}
                disabled={isProcessing}
                className="mt-3 px-4 py-2 bg-pink-50 rounded-xl border border-pink-100 active:bg-pink-100 animate-pulse"
              >
                <Text className="text-pink-500 font-manrope font-black text-[12px]">
                  {isProcessing ? 'Refreshing...' : 'Refresh Code Now'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {mode === 'RECEIVE' && (
            <AmountTriggerButton
              amount={amount}
              onPress={() => {
                setTempAmount(amount);
                setIsModalVisible(true);
              }}
            />
          )}
        </MotiView>

        {mode === 'RECEIVE' ? (
          <>
            <QRActionButtons
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
              qrCardRef={qrCardRef}
            />
            <QRInfoBanner />
          </>
        ) : (
          <View className="bg-white rounded-2xl p-5 flex-row items-center gap-4 border border-gray-50 shadow-sm mb-10">
            <View className="w-10 h-10 bg-pink-50 rounded-xl items-center justify-center border border-pink-100">
              <Info size={20} color="#f48fb1" />
            </View>
            <Text className="text-[10px] font-manrope font-bold text-gray-500 leading-relaxed flex-1">
              แสดงคิวอาร์โค้ดนี้แก่ร้านค้าเพื่อสแกนชำระเงิน รหัสจะรีเฟรชทุกๆ 60 วินาทีเพื่อความปลอดภัยสูงสุดของคุณ
            </Text>
          </View>
        )}
      </ScrollView>

      <AmountModal
        isVisible={isModalVisible}
        onClose={() => !isProcessing && setIsModalVisible(false)}
        tempAmount={tempAmount}
        setTempAmount={setTempAmount}
        onConfirm={handleSetAmount}
        isProcessing={isProcessing}
      />
    </SafeAreaView>
  );
}
