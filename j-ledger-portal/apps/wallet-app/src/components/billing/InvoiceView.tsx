import React from 'react';
import { View, Text } from 'react-native';
import {
  CheckCircle2,
  ArrowDown,
  Store,
  User,
  CreditCard,
} from 'lucide-react-native';
import { format } from 'date-fns';

interface InvoiceItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceViewProps {
  invoice: {
    id: string;
    invoiceNumber: string;
    senderName?: string;
    senderDetail?: string;
    amount: number;
    tax: number;
    feeAmount?: number;
    feeTax?: number;
    total: number;
    currency: string;
    createdAt: string;
    items: InvoiceItem[];
    partnerId?: string;
    referenceId?: string;
    note?: string;
  };
}

export const InvoiceView: React.FC<InvoiceViewProps> = ({ invoice }) => {
  const parseAmount = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof val === 'object') {
      if (Array.isArray(val.d) && val.d.length > 0) {
        const sign = val.s || 1;
        const exp = val.e ?? 0;
        const numStr = val.d.join('');
        const num = parseFloat(numStr) * Math.pow(10, exp - (numStr.length - 1));
        return isNaN(num) ? 0 : sign * num;
      }
    }
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  };

  const formatCurrency = (val: any) => {
    const num = parseAmount(val);
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: invoice.currency || 'THB',
    }).format(num);
  };

  // Helper to extract location from note if present, e.g. "Dinner [Loc: Nonthaburi, Thailand]"
  const extractLocationAndNote = () => {
    const rawNote = invoice.note || '';
    const locMatch = rawNote.match(/\[Loc:\s*([^\]]+)\]/);
    if (locMatch && locMatch[1]) {
      const location = locMatch[1];
      const cleanedNote = rawNote.replace(/\[Loc:\s*[^\]]+\]/, '').trim();
      return { location, note: cleanedNote };
    }
    return { location: 'Bangkok, Thailand', note: rawNote };
  };

  const { location: dynamicLocation, note: cleanedNote } =
    extractLocationAndNote();

  // Determine transaction details dynamically to handle P2P, Top Up, and Merchant payments perfectly
  const getTransferDetails = () => {
    const sender = invoice.senderName || '';
    const firstItemName = invoice.items?.[0]?.name || '';

    const isTopUp =
      sender.toLowerCase().includes('top-up') ||
      firstItemName.toLowerCase().includes('top-up');
    const isP2P =
      sender.toLowerCase().includes('wallet') &&
      firstItemName.toLowerCase().includes('p2p transfer');

    if (isTopUp) {
      return {
        type: 'TOPUP',
        title: 'Top Up Successful',
        sourceName: cleanedNote || 'Linked Bank Account',
        sourceDetail: 'Direct Bank Deposit',
        sourceIcon: <CreditCard size={20} color="#f48fb1" />,
        destName: 'My E-Wallet',
        destDetail: 'P-wallet Account',
        destIcon: <User size={20} color="#f48fb1" />,
      };
    }

    if (isP2P) {
      const recipientName =
        firstItemName.replace('P2P Transfer to ', '').trim() || 'Recipient';
      return {
        type: 'TRANSFER',
        title: 'Transfer Successful',
        sourceName: 'My E-Wallet',
        sourceDetail: 'P-wallet Account',
        sourceIcon: <User size={20} color="#f48fb1" />,
        destName: recipientName,
        destDetail: 'P-wallet Account',
        destIcon: <User size={20} color="#4855a5" />,
      };
    }

    // Default to Merchant Payment (Split payment)
    return {
      type: 'PAYMENT',
      title: 'Payment Successful',
      sourceName: 'My E-Wallet',
      sourceDetail: 'P-wallet Account',
      sourceIcon: <User size={20} color="#f48fb1" />,
      destName: invoice.senderName || 'Merchant Partner',
      destDetail: invoice.senderDetail || 'Partner Store',
      destIcon: <Store size={20} color="#4855a5" />,
    };
  };

  const details = getTransferDetails();
  const displayDate = format(new Date(invoice.createdAt), 'dd MMM yyyy, HH:mm');

  return (
    <View className="bg-white rounded-[2.5rem] p-6 border border-gray-100 shadow-2xl shadow-pink-100/40 overflow-hidden relative">
      {/* Dynamic top gradient decorative bubble */}
      <View className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-50 rounded-full opacity-40" />

      {/* Header Status Banner */}
      <View className="items-center mb-8 mt-2">
        <View className="w-16 h-16 bg-emerald-50 rounded-full items-center justify-center mb-4 shadow-inner">
          <CheckCircle2 size={36} color="#10b981" />
        </View>
        <Text className="text-2xl font-manrope font-black text-gray-800 tracking-tight">
          {details.title}
        </Text>
        <Text className="text-[10px] font-manrope font-bold text-gray-400 mt-1 uppercase tracking-widest">
          Ref ID: {invoice.invoiceNumber.slice(-12).toUpperCase()}
        </Text>
      </View>

      {/* Graphical Routing Flow Card */}
      <View className="bg-gray-50/50 rounded-[2rem] p-5 border border-gray-100 relative mb-6">
        {/* Connector Line and Arrow */}
        <View className="absolute left-[38px] top-[4.5rem] bottom-16 w-[1.5px] bg-gray-200 z-0" />
        <View className="absolute left-[30px] top-[50%] bg-white p-1 rounded-full border border-gray-100 shadow-sm z-10 -translate-y-4">
          <ArrowDown size={14} color="#f48fb1" />
        </View>

        {/* Source Sender Account */}
        <View className="flex-row items-center mb-6 relative z-10">
          <View className="w-12 h-12 rounded-[1.2rem] bg-pink-50 border border-pink-100/30 items-center justify-center shadow-sm">
            {details.sourceIcon}
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-[9px] font-manrope font-black text-gray-400 uppercase tracking-widest mb-0.5">
              Sender
            </Text>
            <Text
              className="text-sm font-manrope font-black text-gray-800"
              numberOfLines={1}
            >
              {details.sourceName}
            </Text>
            <Text className="text-[10px] font-manrope font-bold text-gray-400">
              {details.sourceDetail}
            </Text>
          </View>
        </View>

        {/* Destination Receiver Account */}
        <View className="flex-row items-center relative z-10">
          <View className="w-12 h-12 rounded-[1.2rem] bg-indigo-50 border border-indigo-100/30 items-center justify-center shadow-sm">
            {details.destIcon}
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-[9px] font-manrope font-black text-gray-400 uppercase tracking-widest mb-0.5">
              Recipient
            </Text>
            <Text
              className="text-sm font-manrope font-black text-gray-800"
              numberOfLines={1}
            >
              {details.destName}
            </Text>
            <Text className="text-[10px] font-manrope font-bold text-gray-400">
              {details.destDetail}
            </Text>
          </View>
        </View>
      </View>

      {/* Transaction Details Area */}
      <View className="border-t border-dashed border-gray-200 pt-6 gap-y-4 mb-6">
        <View className="flex-row justify-between items-center">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Payment Method
          </Text>
          <Text className="text-xs font-manrope font-black text-gray-800">
            {details.type === 'TOPUP'
              ? 'Linked Bank Account'
              : 'P-wallet Account'}
          </Text>
        </View>

        <View className="flex-row justify-between items-center">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Transaction Type
          </Text>
          <Text className="text-xs font-manrope font-black text-gray-800">
            {details.type === 'TOPUP'
              ? 'Wallet Top-up'
              : details.type === 'TRANSFER'
                ? 'P2P Transfer'
                : 'Merchant Payment'}
          </Text>
        </View>

        <View className="flex-row justify-between items-center">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Transaction ID
          </Text>
          <Text
            className="text-xs font-manrope font-bold text-gray-800"
            numberOfLines={1}
          >
            {invoice.referenceId ||
              invoice.invoiceNumber.slice(-16).toUpperCase()}
          </Text>
        </View>

        <View className="flex-row justify-between items-center">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Location
          </Text>
          <Text className="text-xs font-manrope font-black text-gray-800">
            {dynamicLocation}
          </Text>
        </View>

        <View className="flex-row justify-between items-center">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Date & Time
          </Text>
          <Text className="text-xs font-manrope font-black text-gray-800">
            {displayDate}
          </Text>
        </View>

        {invoice.feeAmount ? (
          <View className="flex-row justify-between items-center">
            <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
              Fee Deducted
            </Text>
            <Text className="text-xs font-manrope font-black text-red-500">
              -{formatCurrency(Number(invoice.feeAmount))}
            </Text>
          </View>
        ) : null}

        {details.type === 'PAYMENT' && invoice.tax ? (
          <View className="flex-row justify-between items-center">
            <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
              VAT (7%)
            </Text>
            <Text className="text-xs font-manrope font-black text-gray-600">
              {formatCurrency(Number(invoice.tax))}
            </Text>
          </View>
        ) : null}

        <View className="flex-row justify-between items-center border-t border-dashed border-gray-100 pt-4">
          <Text className="text-[10px] font-manrope font-black text-gray-400 uppercase tracking-widest">
            Amount Paid
          </Text>
          <Text className="text-2xl font-manrope font-black text-[#f48fb1]">
            {formatCurrency(
              details.type === 'PAYMENT'
                ? (invoice.total ?? invoice.amount)
                : (invoice.amount ?? invoice.total ?? invoice.items?.[0]?.amount),
            )}
          </Text>
        </View>
      </View>

      {/* Note Disclaimer box inspired by TrueMoney */}
      <View className="bg-rose-50/40 border border-rose-100/30 rounded-2xl p-4 mb-6">
        <Text className="text-[9px] font-manrope font-black text-rose-400 uppercase tracking-widest mb-1">
          Disclaimer
        </Text>
        <Text className="text-[9px] font-manrope font-bold text-gray-400 leading-relaxed">
          Once completed successfully, this transaction is processed instantly
          and cannot be reversed or cancelled under any circumstances.
        </Text>
      </View>
    </View>
  );
};
