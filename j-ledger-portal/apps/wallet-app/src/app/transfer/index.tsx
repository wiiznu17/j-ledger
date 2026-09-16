import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { TransferParamsSchema } from '../../types/transfer';
import { api } from '@/lib/axios';
import { MerchantService } from '@/lib/merchant-service';
import { TransactionAmountCard } from '@/components/transaction/TransactionAmountCard';
import { StickyActionArea } from '@/components/transaction/StickyActionArea';
import { TransactionRecipientCard } from '@/components/transaction/TransactionRecipientCard';
import { TransactionSearchArea } from '@/components/transaction/TransactionSearchArea';
import { ChevronLeft, Info, CalendarClock, Clock } from 'lucide-react-native';

export default function TransferScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    merchantId?: string;
    paymentId?: string;
    recipient?: string;
    amount?: string;
    merchantName?: string;
  }>();

  const [recipient, setRecipient] = React.useState<any>(null);
  const [search, setSearch] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [isScheduled, setIsScheduled] = React.useState(false);
  const [scheduledFrequency, setFrequency] = React.useState('ONCE');
  const [scheduledDate, setScheduledDate] = React.useState(new Date(Date.now() + 86400000)); // Tomorrow
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setScheduledDate(selectedDate);
    }
  };
  const [recipientNotFound, setRecipientNotFound] = React.useState(false);
  const [merchant, setMerchant] = React.useState<any>(null);
  const [isLoadingMerchant, setIsLoadingMerchant] = React.useState(false);
  const [favorites, setFavorites] = React.useState<any[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = React.useState(false);

  React.useEffect(() => {
    if (!recipient && !(params.merchantId || params.paymentId)) {
      loadFavorites();
    }
  }, [recipient]);

  const loadFavorites = async () => {
    try {
      setIsLoadingFavorites(true);
      const res = await api.get('/integration/p2p/favorites');
      setFavorites(res.data || []);
    } catch (err) {
      console.error('Failed to load favorites:', err);
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  const handleSelectFavorite = async (phone: string) => {
    setIsSubmitting(true);
    setRecipientNotFound(false);
    
    // Format phone for search field display
    const cleaned = phone.replace(/\D/g, '');
    let formatted = cleaned;
    if (cleaned.length > 3 && cleaned.length <= 6) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    } else if (cleaned.length > 6) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    setSearch(formatted);

    try {
      const res = await api.post('/integration/p2p/preview', {
        recipientPhone: phone,
        amount: parseFloat(amount) || 1, // Just for preview
      });
      const preview = res.data || {};
      setRecipient({
        phone: phone,
        displayName: preview?.recipient?.displayName || 'Unknown User',
        phoneMasked: preview?.recipient?.phoneMasked || phone,
      });
    } catch (err: any) {
      setRecipientNotFound(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  React.useEffect(() => {
    // Handle params from QR scan (validated by qr-validation)
    if (params.recipient) {
      handleRecipientChange(params.recipient);
    }
    if (params.amount) {
      setAmount(params.amount);
    }
    if (params.merchantId) {
      loadMerchantInfo(params.merchantId);
    } else if (params.paymentId) {
      loadPaymentDetails(params.paymentId);
    }
  }, [params.merchantId, params.paymentId, params.recipient, params.amount]);

  // Auto-search when search is populated from params
  React.useEffect(() => {
    if (
      params.recipient &&
      search.replace(/\D/g, '').length >= 10 &&
      !recipient &&
      !isSubmitting
    ) {
      handleSearch();
    }
  }, [search, params.recipient]);

  const loadPaymentDetails = async (id: string) => {
    try {
      setIsLoadingMerchant(true);
      const data = await MerchantService.getPaymentDetail(id);
      setMerchant({
        merchantName: data.merchantName,
        category: 'Merchant Payment',
      });
      setAmount(data.amount.toString());
    } catch (err) {
      console.error('Failed to load payment details:', err);
      Alert.alert('Error', 'Invalid or expired payment request');
    } finally {
      setIsLoadingMerchant(false);
    }
  };

  const loadMerchantInfo = async (id: string) => {
    try {
      setIsLoadingMerchant(true);
      const data = await MerchantService.previewManualPayment(id);
      setMerchant(data);
    } catch (err) {
      console.error('Failed to load merchant:', err);
      Alert.alert('Error', 'Could not find merchant information');
    } finally {
      setIsLoadingMerchant(false);
    }
  };

  const handleRecipientChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '');
    let formatted = cleaned;
    if (cleaned.length > 3 && cleaned.length <= 6) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    } else if (cleaned.length > 6) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    setSearch(formatted);
  };

  const handleSearch = async () => {
    if (search.replace(/\D/g, '').length < 10) return;

    setIsSubmitting(true);
    setRecipientNotFound(false);

    try {
      const res = await api.post('/integration/p2p/preview', {
        recipientPhone: search,
        amount: parseFloat(amount) || 1, // Just for preview
      });
      const preview = res.data || {};
      setRecipient({
        phone: search,
        displayName: preview?.recipient?.displayName || 'Unknown User',
        phoneMasked: preview?.recipient?.phoneMasked || search,
      });
    } catch (err: any) {
      setRecipientNotFound(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (isSubmitting) return;

    const baseParams = {
      amount,
      note,
      isScheduled: isScheduled ? 'true' : 'false',
      frequency: scheduledFrequency,
      scheduledDate: scheduledDate.toISOString(),
    };

    if (params.merchantId || params.paymentId) {
      // Merchant Pay logic remains
      router.push({
        pathname: '/transfer/review',
        params: {
          ...baseParams,
          merchantId: params.merchantId,
          paymentId: params.paymentId,
          merchantName: merchant?.merchantName,
        },
      } as any);
      return;
    }

    // For P2P, we already have the recipient object from handleSearch
    if (!recipient) {
      handleSearch();
      return;
    }

    router.push({
      pathname: '/transfer/review',
      params: {
        ...baseParams,
        recipient: recipient.phone,
        recipientName: recipient.displayName,
        recipientMasked: recipient.phoneMasked,
      },
    } as any);
  };

  const handleQuickAmount = (val: string) => {
    setAmount(val);
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 px-5">
          {/* Header */}
          <View className="flex-row items-center justify-between pt-2 pb-2">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 rounded-2xl bg-white border border-gray-100 flex items-center justify-center shadow-sm"
            >
              <ChevronLeft size={24} color="#1a1a1a" />
            </TouchableOpacity>
            <Text className="text-lg font-manrope font-black text-gray-800 tracking-tight">
              Transfer Money
            </Text>
            <View className="w-10" />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              className="mt-4 mb-6"
            >
              {params.merchantId || params.paymentId ? (
                /* Unified Merchant Mode */
                <TransactionRecipientCard
                  name={merchant?.merchantName}
                  subtitle={
                    merchant?.category ||
                    (params.paymentId ? 'Payment Request' : 'Verified Business')
                  }
                  type="merchant"
                />
              ) : recipient ? (
                /* Selected Person Mode */
                <TransactionRecipientCard
                  name={(recipient as any).displayName}
                  subtitle={(recipient as any).phoneMasked}
                  type="user"
                  onClear={() => {
                    setRecipient('' as any);
                    setAmount('');
                  }}
                />
              ) : (
                /* Search Mode */
                <TransactionSearchArea
                  value={search}
                  onChangeText={handleRecipientChange}
                  onSearch={handleSearch}
                  onClear={() => setSearch('')}
                  isLoading={isSubmitting}
                />
              )}
            </MotiView>

            {/* Favorite Recipients Horizontal list */}
            {!recipient && !(params.merchantId || params.paymentId) && favorites.length > 0 && (
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="mb-6"
              >
                <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">
                  Favorite Contacts
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingLeft: 4 }}
                >
                  {favorites.map((fav) => (
                    <TouchableOpacity
                      key={fav.id}
                      onPress={() => handleSelectFavorite(fav.recipientPhone)}
                      className="items-center w-16 active:scale-95 transition-all"
                    >
                      <View className="w-12 h-12 rounded-full bg-purple-50 border border-purple-100 items-center justify-center mb-1 shadow-sm">
                        <Text className="font-manrope font-black text-purple-500 text-sm">
                          {(fav.nickname || fav.recipientName || 'U').slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        className="text-[10px] font-manrope font-black text-gray-600 text-center w-full"
                      >
                        {fav.nickname || fav.recipientName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </MotiView>
            )}

            {/* Amount Card */}
            <TransactionAmountCard
              amount={amount}
              onAmountChange={setAmount}
              label="Total Amount to Send"
            />

            {/* Note Input */}
            <View className="mb-6">
              <View className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-2 flex-row items-center">
                <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase mr-3">
                  Note:
                </Text>
                <TextInput
                  placeholder="Add a payment note..."
                  placeholderTextColor="#9ca3af"
                  value={note}
                  onChangeText={setNote}
                  className="flex-1 font-manrope font-bold text-xs text-gray-800"
                  style={{ paddingVertical: 4 }}
                />
              </View>
            </View>

            {/* Scheduling Options */}
            <View className="mb-6">
              <View className="flex-row items-center justify-between px-1 mb-3">
                <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
                  Transfer Schedule
                </Text>
                <TouchableOpacity
                  onPress={() => setIsScheduled(!isScheduled)}
                  className={`px-3 py-1 rounded-full border ${isScheduled ? 'bg-indigo-50 border-indigo-100' : 'bg-gray-50 border-gray-100'}`}
                >
                  <Text className={`text-[10px] font-manrope font-black ${isScheduled ? 'text-indigo-500' : 'text-gray-400'}`}>
                    {isScheduled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              </View>

              {isScheduled && (
                <MotiView
                  from={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 160 }}
                  className="bg-white rounded-3xl border border-indigo-50 p-4 overflow-hidden shadow-sm"
                >
                  {/* Frequency Selection */}
                  <View className="flex-row gap-2 mb-4">
                    {['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'].map((f) => (
                      <TouchableOpacity
                        key={f}
                        onPress={() => setFrequency(f)}
                        className={`flex-1 py-2 rounded-xl items-center justify-center border ${scheduledFrequency === f ? 'bg-indigo-500 border-indigo-500' : 'bg-gray-50 border-gray-100'}`}
                      >
                        <Text className={`text-[9px] font-black uppercase ${scheduledFrequency === f ? 'text-white' : 'text-gray-500'}`}>
                          {f === 'ONCE' ? 'Once' : f.charAt(0) + f.slice(1).toLowerCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Date Selection Display */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setShowDatePicker(true)}
                    className="flex-row items-center gap-4 bg-gray-50 p-3 rounded-2xl border border-gray-100"
                  >
                    <View className="w-10 h-10 rounded-full bg-white items-center justify-center shadow-xs">
                      <CalendarClock size={18} color="#6366f1" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[9px] font-black text-gray-400 uppercase">First Execution Date</Text>
                      <Text className="text-sm font-manrope font-black text-gray-800">
                        {scheduledDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </Text>
                    </View>
                    <View className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                      <Text className="text-[10px] font-black text-indigo-600">Change Date</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Native Date Picker for Android */}
                  {Platform.OS === 'android' && showDatePicker && (
                    <DateTimePicker
                      value={scheduledDate}
                      mode="date"
                      display="default"
                      minimumDate={new Date(Date.now() + 86400000)}
                      onChange={onDateChange}
                    />
                  )}

                  {/* Modal Date Picker for iOS */}
                  {Platform.OS === 'ios' && (
                    <Modal
                      visible={showDatePicker}
                      transparent
                      animationType="fade"
                      onRequestClose={() => setShowDatePicker(false)}
                    >
                      <View className="flex-1 justify-end bg-black/40">
                        <View className="bg-white rounded-t-3xl p-6 pb-10">
                          <View className="flex-row justify-between items-center mb-4">
                            <Text className="text-base font-bold text-gray-900">Select Transfer Date</Text>
                            <TouchableOpacity
                              onPress={() => setShowDatePicker(false)}
                              className="px-4 py-2 bg-indigo-500 rounded-xl"
                            >
                              <Text className="text-xs font-bold text-white">Done</Text>
                            </TouchableOpacity>
                          </View>
                          <DateTimePicker
                            value={scheduledDate}
                            mode="date"
                            display="spinner"
                            minimumDate={new Date(Date.now() + 86400000)}
                            onChange={onDateChange}
                          />
                        </View>
                      </View>
                    </Modal>
                  )}
                </MotiView>
              )}
            </View>

            {/* Recipient Not Found Warning */}
            {recipientNotFound && (
              <MotiView
                from={{ opacity: 0, translateY: -10 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="bg-red-50 p-4 rounded-2xl border border-red-100 flex-row items-center gap-3 mb-4"
              >
                <Info size={16} color="#ef4444" />
                <View className="flex-1">
                  <Text className="text-xs font-manrope font-black text-red-600 mb-0.5">
                    Recipient Not Found
                  </Text>
                  <Text className="text-[10px] font-manrope font-medium text-red-500 leading-relaxed">
                    This phone number is not registered in P-wallet. Please
                    check the number or invite them to join.
                  </Text>
                </View>
              </MotiView>
            )}

            {/* Warning Banner */}
            <View className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex-row items-center gap-3 mb-6">
              <Info size={14} color="#f97316" />
              <Text className="text-[9px] font-manrope font-bold text-gray-500 leading-relaxed flex-1">
                Please confirm the recipient's identity. Transfers cannot be
                refunded.
              </Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Sticky Action Area */}
      <StickyActionArea
        isVisible={true}
        label={isSubmitting ? 'Processing...' : 'Next Step'}
        onPress={handleNext}
        disabled={
          isSubmitting ||
          (!params.merchantId && !params.paymentId && !recipient) ||
          !amount ||
          parseFloat(amount) <= 0
        }
        isLoading={isSubmitting}
      />
    </SafeAreaView>
  );
}
