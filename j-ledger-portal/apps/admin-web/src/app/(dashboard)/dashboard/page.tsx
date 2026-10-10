'use client';

import {
  Activity,
  DollarSign,
  ArrowRightLeft,
  CreditCard,
  ShieldCheck,
  Users,
  TrendingUp,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Zap,
  RefreshCw,
  Info,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatCard } from '@/components/dashboard/StatCard';
import { TransactionVolumeChart } from '@/components/dashboard/TransactionVolumeChart';
import { TransactionDistributionChart } from '@/components/dashboard/TransactionDistributionChart';
import TreasuryHealthChart from '@/components/dashboard/TreasuryHealthChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { transactionRequester, dashboardRequester } from '@/lib/requesters';
import type { DashboardStats } from '@/lib/requesters/dashboardRequester';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { Button } from '@/components/ui/button';




export default function DashboardPage() {
  // Independent Date Range States
  const [liquidityRange, setLiquidityRange] = useState<string>('30d');
  const [revenueRange, setRevenueRange] = useState<string>('30d');
  const [performanceRange, setPerformanceRange] = useState<string>('30d');
  const [volumeRange, setVolumeRange] = useState<string>('30d');
  const [distributionRange, setDistributionRange] = useState<string>('30d');

  // Loading States
  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [volumeLoading, setVolumeLoading] = useState(true);
  const [distributionLoading, setDistributionLoading] = useState(true);

  // Data States
  const [liquidityStats, setLiquidityStats] = useState({
    balance: 1000.0,
    trend: [] as any[],
    growthText: '+12.5%',
    growthType: 'up' as 'up' | 'down' | 'neutral',
  });
  const [revenueStats, setRevenueStats] = useState({
    revenue: 24560.0,
    trend: [] as any[],
    growthText: '+18.2%',
    growthType: 'up' as 'up' | 'down' | 'neutral',
  });
  const [performanceStats, setPerformanceStats] = useState({
    activeUsers: 3,
    activeUsersGrowth: '+20.0%',
    activeUsersGrowthType: 'up' as 'up' | 'down' | 'neutral',
    kycApproved: 2,
    kycGrowth: '+8.3%',
    kycGrowthType: 'up' as 'up' | 'down' | 'neutral',
    vatPayable: 0.01,
    vatGrowth: '-4.8%',
    vatGrowthType: 'down' as 'up' | 'down' | 'neutral',
    failedTransactions: 0,
    failedGrowth: '-100.0%',
    failedGrowthType: 'up' as 'up' | 'down' | 'neutral',
    totalTransactions: 0,
    treasuryHealth: {
      healthScore: 88,
      reserveRatio: 124,
      bankFloat: 15430,
      settlementPending: 12,
    },
  });

  const [volumeChartData, setVolumeChartData] = useState<any[]>([]);
  const [distributionData, setDistributionData] = useState<any[]>([]);
  const [lastUpdatedText, setLastUpdatedText] = useState<string>('Just now');
  const [systemLatency, setSystemLatency] = useState<number>(42);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getDateRangeISO = (range: string) => {
    let from: string | undefined;
    let to: string | undefined;
    const now = new Date();

    if (range === 'today') {
      from = startOfDay(now).toISOString();
      to = endOfDay(now).toISOString();
    } else if (range === '30d') {
      from = startOfDay(subDays(now, 30)).toISOString();
      to = endOfDay(now).toISOString();
    } else if (range === '1y') {
      from = startOfDay(subDays(now, 365)).toISOString();
      to = endOfDay(now).toISOString();
    } else if (range === 'all') {
      from = undefined;
      to = undefined;
    }
    return { from, to };
  };

  // 1. Fetch Liquidity Sparkline and Balance
  const fetchLiquidityData = async (range: string = liquidityRange) => {
    try {
      setLiquidityLoading(true);
      const start = performance.now();
      const { from, to } = getDateRangeISO(range);
      const stats: DashboardStats | null = await dashboardRequester.getStats({
        from,
        to,
      });
      const duration = Math.round(performance.now() - start);
      setSystemLatency(duration > 0 ? Math.min(120, duration) : 42);

      if (stats) {
        const balance = stats.financial?.totalSystemBalance ?? 1000.0;
        const realTrend =
          stats.balanceTrend && stats.balanceTrend.length > 0
            ? stats.balanceTrend
            : [{ time: 'Now', balance }];

        const lGrowth = stats.growth?.liquidityGrowth ?? 12.5;
        setLiquidityStats({
          balance,
          trend: realTrend,
          growthText: `${lGrowth >= 0 ? '+' : ''}${lGrowth.toFixed(1)}%`,
          growthType: lGrowth > 0 ? 'up' : lGrowth < 0 ? 'down' : 'neutral',
        });
        console.log('Liquidity Stats:', liquidityStats);
      }
    } catch (e) {
      toast.error('Failed to fetch system liquidity.');
    } finally {
      setLiquidityLoading(false);
    }
  };

  // 2. Fetch Revenue Sparkline and Value
  const fetchRevenueData = async (range: string = revenueRange) => {
    try {
      setRevenueLoading(true);
      const { from, to } = getDateRangeISO(range);
      const stats: DashboardStats | null = await dashboardRequester.getStats({
        from,
        to,
      });

      if (stats) {
        const revenue = stats.financial?.totalRevenue ?? 0;
        const realRevenueTrend =
          stats.revenueTrend && stats.revenueTrend.length > 0
            ? stats.revenueTrend
            : [{ time: 'Now', revenue }];

        const rGrowth = stats.growth?.revenueGrowth ?? 18.2;
        setRevenueStats({
          revenue,
          trend: realRevenueTrend,
          growthText: `${rGrowth >= 0 ? '+' : ''}${rGrowth.toFixed(1)}%`,
          growthType: rGrowth > 0 ? 'up' : rGrowth < 0 ? 'down' : 'neutral',
        });
      }
    } catch (e) {
      toast.error('Failed to fetch revenue flow.');
    } finally {
      setRevenueLoading(false);
    }
  };

  // 3. Fetch Core Performance Stats
  const fetchPerformanceData = async (range: string = performanceRange) => {
    try {
      setPerformanceLoading(true);
      const { from, to } = getDateRangeISO(range);
      const stats: DashboardStats | null = await dashboardRequester.getStats({
        from,
        to,
      });

      if (stats) {
        const uGrowth = stats.growth?.activeUsersGrowth ?? 20.0;
        const kGrowth = stats.growth?.kycGrowth ?? 8.3;
        const vGrowth = stats.growth?.vatGrowth ?? -4.8;
        const fGrowth = stats.growth?.failedGrowth ?? -100.0;

        setPerformanceStats({
          activeUsers: stats.totalActiveUsers ?? 0,
          activeUsersGrowth: `${uGrowth >= 0 ? '+' : ''}${uGrowth.toFixed(1)}%`,
          activeUsersGrowthType:
            uGrowth > 0 ? 'up' : uGrowth < 0 ? 'down' : 'neutral',
          kycApproved: stats.kyc?.approvedToday ?? 0,
          kycGrowth: `${kGrowth >= 0 ? '+' : ''}${kGrowth.toFixed(1)}%`,
          kycGrowthType: kGrowth > 0 ? 'up' : kGrowth < 0 ? 'down' : 'neutral',
          vatPayable: stats.financial?.totalVatPayable ?? 0,
          vatGrowth: `${vGrowth >= 0 ? '+' : ''}${vGrowth.toFixed(1)}%`,
          vatGrowthType: vGrowth > 0 ? 'up' : vGrowth < 0 ? 'down' : 'neutral',
          failedTransactions: stats.failedTransactions ?? 0,
          failedGrowth: `${fGrowth >= 0 ? '+' : ''}${fGrowth.toFixed(1)}%`,
          failedGrowthType:
            fGrowth < 0 ? 'up' : fGrowth > 0 ? 'down' : 'neutral',
          totalTransactions: stats.totalTransactions ?? 0,
          treasuryHealth: {
            healthScore: stats.treasuryHealth?.healthScore ?? 88,
            reserveRatio: stats.treasuryHealth?.reserveRatio ?? 124,
            bankFloat: stats.treasuryHealth?.bankFloat ?? 15430,
            settlementPending: stats.treasuryHealth?.settlementPending ?? 0,
          },
        });
      }
    } catch (e) {
      toast.error('Failed to fetch performance metrics.');
    } finally {
      setPerformanceLoading(false);
    }
  };

  // 4. Fetch Volume Chart Data
  const fetchVolumeData = async (range: string = volumeRange) => {
    try {
      setVolumeLoading(true);
      const { from, to } = getDateRangeISO(range);
      const stats: DashboardStats | null = await dashboardRequester.getStats({
        from,
        to,
      });
      if (stats) {
        setVolumeChartData(stats.chartData || []);
      }
    } catch (e) {
      toast.error('Failed to fetch volume data.');
    } finally {
      setVolumeLoading(false);
    }
  };

  // 5. Fetch Distribution Chart Data
  const fetchDistributionData = async (range: string = distributionRange) => {
    try {
      setDistributionLoading(true);
      const { from, to } = getDateRangeISO(range);
      const stats: DashboardStats | null = await dashboardRequester.getStats({
        from,
        to,
      });
      if (stats) {
        setDistributionData(stats.distribution || []);
      }
    } catch (e) {
      toast.error('Failed to fetch distribution data.');
    } finally {
      setDistributionLoading(false);
    }
  };

  // Global consolidated refresh
  const handleRefreshAll = async () => {
    const now = new Date();
    setLastUpdatedText(
      `at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    );
    await Promise.all([
      fetchLiquidityData(liquidityRange),
      fetchRevenueData(revenueRange),
      fetchPerformanceData(performanceRange),
      fetchVolumeData(volumeRange),
      fetchDistributionData(distributionRange),
    ]);
  };

  useEffect(() => {
    fetchLiquidityData();
  }, [liquidityRange]);

  useEffect(() => {
    fetchRevenueData();
  }, [revenueRange]);

  useEffect(() => {
    fetchPerformanceData();
  }, [performanceRange]);

  useEffect(() => {
    fetchVolumeData();
  }, [volumeRange]);

  useEffect(() => {
    fetchDistributionData();
  }, [distributionRange]);

  const isRefreshing =
    liquidityLoading ||
    revenueLoading ||
    performanceLoading ||
    volumeLoading ||
    distributionLoading;

  return (
    <div className="space-y-6 animate-in fade-in duration-700 max-w-[1600px] mx-auto pb-12 text-foreground">
      {/* SECTION 1: SYSTEM HEALTH INDICATORS ROW (UNIFIED CARD WITH DIVIDERS) */}
      <div className="grid grid-cols-2 md:grid-cols-5 bg-card border border-border/80 rounded-xl overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border/60 shadow-xs w-full">
        {/* Treasury Status */}
        <div className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors">
          <div
            className={`p-1.5 rounded-full ${
              performanceStats.treasuryHealth.healthScore >= 90
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : performanceStats.treasuryHealth.healthScore >= 70
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
              Treasury Status
            </span>
            <span
              className={`block text-xs font-black tracking-wide mt-0.5 ${
                performanceStats.treasuryHealth.healthScore >= 90
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : performanceStats.treasuryHealth.healthScore >= 70
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400'
              }`}
            >
              {performanceStats.treasuryHealth.healthScore >= 90
                ? 'Healthy'
                : performanceStats.treasuryHealth.healthScore >= 70
                  ? 'Warning'
                  : 'Critical'}
            </span>
          </div>
        </div>

        {/* Settlement Queue */}
        <div className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors">
          <div className="p-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
              Settlement Queue
            </span>
            <span className="block text-xs font-black text-foreground tracking-wide mt-0.5">
              {performanceStats.treasuryHealth.settlementPending} Pending
            </span>
          </div>
        </div>

        {/* Fraud Alerts */}
        <div className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors">
          <div className="p-1.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
              Fraud Alerts
              <span className="text-[8px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded font-black tracking-wider uppercase shrink-0">
                Mock Data
              </span>
            </span>
            <span className="block text-xs font-black text-foreground tracking-wide mt-0.5">
              0
            </span>
          </div>
        </div>

        {/* System Latency */}
        <div className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors">
          <div className="p-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Zap className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
              System Latency
            </span>
            <span className="block text-xs font-black text-foreground tracking-wide mt-0.5">
              {systemLatency}ms
            </span>
          </div>
        </div>

        {/* Blinking Live indicator */}
        <div className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors col-span-2 md:col-span-1">
          <div>
            <span className="block text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
              Last updated:
            </span>
            <span className="block text-xs font-medium text-muted-foreground truncate mt-0.5">
              {lastUpdatedText}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
            <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 tracking-wider uppercase">
              Live
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 2: HUGE HIGHLIGHT CARDS (Total Liquidity / Revenue Flow) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 w-full">
        {/* Total System Liquidity - Dark Gradient Indigo Card */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#5f52fa] to-[#3a2df3] border-none shadow-lg shadow-indigo-600/10 text-white rounded-2xl p-6 flex flex-col justify-between min-h-[165px] group hover:shadow-xl transition-all duration-300">
          {/* Left/Content block */}
          <div className="flex flex-col h-full justify-between z-10 relative">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-indigo-100 uppercase">
                  Total System Liquidity
                </span>
                <InfoTooltip
                  content="ยอดเงินรวมทั้งหมดที่กำลังหมุนเวียนอยู่ในระบบ คำนวณจากยอดเงินสุทธิของบัญชีทั้งหมด ยกเว้นบัญชีธนาคารที่ใช้เป็นตัวกลาง"
                  iconClassName="text-indigo-200 hover:text-white"
                />
              </div>
              {liquidityLoading ? (
                <div className="h-10 w-44 bg-white/20 animate-pulse rounded-md" />
              ) : (
                <span className="block text-3xl sm:text-4xl font-black tracking-tight leading-none text-white">
                  ฿{' '}
                  {liquidityStats.balance.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
              <span className="block text-[11px] font-semibold text-indigo-200">
                Total funds circulating across all ledgers
              </span>
            </div>

            <div className="pt-3 flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  liquidityStats.growthType === 'up'
                    ? 'bg-white/10 text-emerald-300'
                    : liquidityStats.growthType === 'down'
                      ? 'bg-white/10 text-rose-300'
                      : 'bg-white/10 text-slate-300'
                }`}
              >
                {liquidityStats.growthText}
              </span>
              <span className="text-[10px] font-semibold text-indigo-200/90">
                {liquidityRange === 'today'
                  ? 'vs last 24h'
                  : liquidityRange === '30d'
                    ? 'vs last 30 days'
                    : liquidityRange === '1y'
                      ? 'vs last year'
                      : 'vs previous period'}
              </span>
            </div>
          </div>

          {/* Absolute Sparkline trend chart sitting flush bottom-right */}
          <div className="absolute bottom-0 right-0 w-[240px] sm:w-[280px] md:w-[320px] lg:w-[260px] xl:w-[350px] h-[110px] z-10">
            {mounted &&
              !liquidityLoading &&
              liquidityStats.trend.length > 0 && (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart
                    data={liquidityStats.trend}
                    margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient
                        id="colorLiquiditySpark"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#FFFFFF"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="#FFFFFF"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (
                          active &&
                          payload &&
                          payload.length > 0 &&
                          payload[0]
                        ) {
                          const data = payload[0].payload;
                          if (!data) return null;
                          return (
                            <div className="bg-indigo-950/95 border border-indigo-500/30 backdrop-blur-md rounded-lg p-2 shadow-xl text-left select-none pointer-events-none z-30">
                              <span className="block text-[8px] font-black uppercase text-indigo-300 tracking-wider">
                                {data.time}
                              </span>
                              <span className="block text-xs font-black text-white mt-0.5">
                                ฿{' '}
                                {Number(data.balance).toLocaleString('th-TH', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          );
                        }
                        return null;
                      }}
                      cursor={{
                        stroke: 'rgba(255, 255, 255, 0.15)',
                        strokeWidth: 1,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorLiquiditySpark)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Small selector overlay inside card header absolute top-right */}
          <div className="absolute top-4 right-4 bg-white/10 border border-white/15 rounded-lg p-0.5 shadow-xs z-20">
            <Select
              value={liquidityRange}
              onValueChange={(val) => val && setLiquidityRange(val)}
            >
              <SelectTrigger className="w-[65px] border-none focus:ring-0 focus:outline-hidden focus-visible:ring-0 shadow-none h-6 text-[10px] font-black text-white bg-transparent py-0 px-2 justify-between">
                <SelectValue placeholder="30D" />
              </SelectTrigger>
              <SelectContent className="bg-indigo-900 border-indigo-700 text-white">
                <SelectItem
                  value="today"
                  className="text-white focus:bg-indigo-800 focus:text-white"
                >
                  Today
                </SelectItem>
                <SelectItem
                  value="30d"
                  className="text-white focus:bg-indigo-800 focus:text-white"
                >
                  30D
                </SelectItem>
                <SelectItem
                  value="1y"
                  className="text-white focus:bg-indigo-800 focus:text-white"
                >
                  1Y
                </SelectItem>
                <SelectItem
                  value="all"
                  className="text-white focus:bg-indigo-800 focus:text-white"
                >
                  All
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Revenue Flow - Light Beautiful Indigo Card */}
        <div className="relative overflow-hidden bg-card border border-border/80 shadow-md shadow-slate-200/40 hover:shadow-lg transition-all duration-300 rounded-2xl p-6 flex flex-col justify-between min-h-[165px] group">
          {/* Left/Content block */}
          <div className="flex flex-col h-full justify-between z-10 relative">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                  Revenue Flow (30 Days)
                </span>
                <InfoTooltip
                  content="รายได้สะสมของระบบจากค่าธรรมเนียมการทำธุรกรรม เช่น ค่า Fee การชำระเงินร้านค้า และ P2P โอนเงิน"
                  iconClassName="text-muted-foreground hover:text-foreground"
                />
              </div>
              {revenueLoading ? (
                <div className="h-10 w-44 bg-muted animate-pulse rounded-md" />
              ) : (
                <span className="block text-3xl sm:text-4xl font-black tracking-tight leading-none text-slate-800 dark:text-slate-100">
                  ฿{' '}
                  {revenueStats.revenue.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
              <span className="block text-[11px] font-semibold text-muted-foreground">
                Total revenue collected in this period
              </span>
            </div>

            <div className="pt-3 flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                  revenueStats.growthType === 'up'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : revenueStats.growthType === 'down'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                }`}
              >
                {revenueStats.growthText}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">
                {revenueRange === 'today'
                  ? 'vs last 24h'
                  : revenueRange === '30d'
                    ? 'vs last 30 days'
                    : revenueRange === '1y'
                      ? 'vs last year'
                      : 'vs previous period'}
              </span>
            </div>
          </div>

          {/* Absolute Sparkline trend chart sitting flush bottom-right */}
          <div className="absolute bottom-0 right-0 w-[240px] sm:w-[280px] md:w-[320px] lg:w-[260px] xl:w-[350px] h-[110px] z-10">
            {mounted && !revenueLoading && revenueStats.trend.length > 0 && (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart
                  data={revenueStats.trend}
                  margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                >
                  <defs>
                    <linearGradient
                      id="colorRevenueSpark"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#4f46e5"
                        stopOpacity={0.15}
                      />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (
                        active &&
                        payload &&
                        payload.length > 0 &&
                        payload[0]
                      ) {
                        const data = payload[0].payload;
                        if (!data) return null;
                        return (
                          <div className="bg-slate-900/95 dark:bg-slate-950/95 border border-indigo-500/20 dark:border-indigo-500/30 backdrop-blur-md rounded-lg p-2 shadow-xl text-left select-none pointer-events-none z-30">
                            <span className="block text-[8px] font-black uppercase text-muted-foreground tracking-wider">
                              {data.time}
                            </span>
                            <span className="block text-xs font-black text-indigo-600 dark:text-indigo-400 mt-0.5">
                              ฿{' '}
                              {Number(data.revenue).toLocaleString('th-TH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    }}
                    cursor={{
                      stroke: 'rgba(79, 70, 229, 0.15)',
                      strokeWidth: 1,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#4f46e5"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorRevenueSpark)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Small selector overlay inside card header absolute top-right */}
          <div className="absolute top-4 right-4 bg-card border border-border rounded-lg p-0.5 shadow-xs hover:border-muted-foreground/30 transition-colors z-20">
            <Select
              value={revenueRange}
              onValueChange={(val) => val && setRevenueRange(val)}
            >
              <SelectTrigger className="w-[65px] border-none focus:ring-0 focus:outline-hidden focus-visible:ring-0 shadow-none h-6 text-[10px] font-black text-foreground bg-transparent py-0 px-2 justify-between">
                <SelectValue placeholder="30D" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="30d">30D</SelectItem>
                <SelectItem value="1y">1Y</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* SECTION 3: KEY STATS CARDS (Active Users, KYC Approved, VAT Payable, Failed Transactions) */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 w-full">
        {/* Active Users */}
        <StatCard
          title="Active Users"
          value={performanceStats.activeUsers.toLocaleString()}
          description="Verified accounts"
          icon={Users}
          trendText={performanceStats.activeUsersGrowth}
          trendSub={
            performanceRange === 'today'
              ? 'vs last 24h'
              : performanceRange === '30d'
                ? 'vs last 30 days'
                : performanceRange === '1y'
                  ? 'vs last year'
                  : 'vs previous period'
          }
          trendType={performanceStats.activeUsersGrowthType}
          isLoading={performanceLoading}
        />

        {/* KYC Approved */}
        <StatCard
          title="KYC Approved"
          value={performanceStats.kycApproved}
          description="Success rate 66.7%"
          icon={ShieldCheck}
          trendText={performanceStats.kycGrowth}
          trendSub={
            performanceRange === 'today'
              ? 'vs last 24h'
              : performanceRange === '30d'
                ? 'vs last 30 days'
                : performanceRange === '1y'
                  ? 'vs last year'
                  : 'vs previous period'
          }
          trendType={performanceStats.kycGrowthType}
          isLoading={performanceLoading}
        />

        {/* VAT Payable */}
        <StatCard
          title="VAT Payable"
          value={`฿ ${performanceStats.vatPayable.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          description="Accumulated tax"
          icon={CreditCard}
          trendText={performanceStats.vatGrowth}
          trendSub={
            performanceRange === 'today'
              ? 'vs last 24h'
              : performanceRange === '30d'
                ? 'vs last 30 days'
                : performanceRange === '1y'
                  ? 'vs last year'
                  : 'vs previous period'
          }
          trendType={performanceStats.vatGrowthType}
          isLoading={performanceLoading}
        />

        {/* Failed Transactions */}
        <StatCard
          title="Failed Transactions"
          value={performanceStats.failedTransactions}
          description={`Failure rate ${
            performanceStats.totalTransactions > 0
              ? (
                  (performanceStats.failedTransactions /
                    performanceStats.totalTransactions) *
                  100
                ).toFixed(2)
              : '0.00'
          }%`}
          icon={ShieldAlert}
          trendText={performanceStats.failedGrowth}
          trendSub={
            performanceRange === 'today'
              ? 'vs last 24h'
              : performanceRange === '30d'
                ? 'vs last 30 days'
                : performanceRange === '1y'
                  ? 'vs last year'
                  : 'vs previous period'
          }
          trendType={performanceStats.failedGrowthType}
          isLoading={performanceLoading}
        />
      </div>

      {/* SECTION 4: DETAILED ANALYTICS GRID (Volume 3/7, Distribution 2/7, Treasury Health Gauge 2/7) */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-5 items-stretch w-full">
        {/* Transaction Volume Chart (3/7 width) */}
        <div className="lg:col-span-3">
          {mounted ? (
            <TransactionVolumeChart
              data={volumeChartData}
              dateRange={volumeRange}
              onDateRangeChange={(val) => setVolumeRange(val)}
              isLoading={volumeLoading}
            />
          ) : (
            <div className="h-[300px] w-full bg-card animate-pulse rounded-xl" />
          )}
        </div>

        {/* Transaction Distribution Chart (2/7 width) */}
        <div className="lg:col-span-2">
          {mounted ? (
            <TransactionDistributionChart
              data={distributionData}
              dateRange={distributionRange}
              onDateRangeChange={(val) => setDistributionRange(val)}
              isLoading={distributionLoading}
            />
          ) : (
            <div className="h-[300px] w-full bg-card animate-pulse rounded-xl" />
          )}
        </div>

        {/* Treasury Health Gauge Chart (2/7 width) */}
        <div className="lg:col-span-2">
          {mounted ? (
            <TreasuryHealthChart
              healthScore={performanceStats.treasuryHealth.healthScore}
              reserveRatio={performanceStats.treasuryHealth.reserveRatio}
              bankFloat={performanceStats.treasuryHealth.bankFloat}
              settlementPending={
                performanceStats.treasuryHealth.settlementPending
              }
              isLoading={performanceLoading}
            />
          ) : (
            <div className="h-[300px] w-full bg-card animate-pulse rounded-xl" />
          )}
        </div>
      </div>

      {/* SECTION 5: RECENT TRANSACTIONS TABLE */}
      <div className="w-full">
        <RecentTransactions />
      </div>
    </div>
  );
}
