'use client';

import {
  Activity,
  AlertTriangle,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Send,
  ShieldCheck,
  Users,
  LucideIcon,
  Ticket,
  Image as ImageIcon,
  ClipboardList,
  Menu,
  Briefcase,
  Landmark,
  SlidersHorizontal,
  ShieldAlert,
  Ban,
  CheckSquare,
  Lock,
  HelpCircle,
  Smartphone,
  BarChart3,
  Search,
  Database,
  History,
  Wallet,
  Coins,
  Settings,
  Store,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Permission } from '@repo/dto';

interface NavigationItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
  requiredPermission?: Permission;
  isNew?: boolean;
  isSoon?: boolean;
}

interface NavigationGroup {
  title: string;
  items: NavigationItem[];
}

interface SidebarProps {
  onLogout: (formData: FormData) => void;
  onToggle?: () => void;
  isCollapsed?: boolean;
  userRole?: string;
  permissions?: string[];
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const navigationGroups: NavigationGroup[] = [
  {
    title: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Transactions', href: '/transactions', icon: Activity },
    ],
  },
  {
    title: 'Finance & Accounting',
    items: [
      {
        name: 'Treasury',
        href: '/finance/treasury',
        icon: Landmark,
        requiredPermission: Permission.VIEW_TRANSACTIONS,
      },
      {
        name: 'Settlement',
        href: '/finance/settlement',
        icon: Briefcase,
        requiredPermission: Permission.VIEW_TRANSACTIONS,
      },
      {
        name: 'Customer Wallets',
        href: '/finance/wallets',
        icon: Wallet,
        requiredPermission: Permission.VIEW_USERS,
      },
      {
        name: 'Internal Ledger',
        href: '/finance/ledger',
        icon: Landmark,
        requiredPermission: Permission.VIEW_LEDGER_ENTRIES,
      },
      {
        name: 'Reconcile',
        href: '/finance/reconcile',
        icon: ShieldCheck,
        requiredPermission: Permission.RUN_RECONCILIATION,
      },
    ],
  },
  {
    title: 'Risk & Compliance',
    items: [
      {
        name: 'KYC Verification',
        href: '/risk/kyc',
        icon: ShieldCheck,
        requiredPermission: Permission.VIEW_USERS,
      },
      {
        name: 'AML Monitor',
        href: '/risk/aml',
        icon: AlertTriangle,
        requiredPermission: Permission.VIEW_SUSPICIOUS_ACTIVITIES,
      },
      {
        name: 'Fraud Mgmt',
        href: '/risk/fraud',
        icon: ShieldAlert,
        requiredPermission: Permission.VIEW_SUSPICIOUS_ACTIVITIES,
      },
      {
        name: 'Fraud Rules',
        href: '/risk/fraud/rules',
        icon: SlidersHorizontal,
        requiredPermission: Permission.MANAGE_SYSTEM_SETTINGS,
      },
      {
        name: 'Blacklist',
        href: '/risk/blacklist',
        icon: Ban,
        requiredPermission: Permission.REPORT_TO_AMLO,
      },
    ],
  },
  {
    title: 'Promotions',
    items: [
      {
        name: 'Deals',
        href: '/promotions/deals',
        icon: Ticket,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'Banners',
        href: '/promotions/banners',
        icon: ImageIcon,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'Redemptions',
        href: '/promotions/redemptions',
        icon: ClipboardList,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'POS Simulator',
        href: '/promotions/deals/simulator',
        icon: Smartphone,
        requiredPermission: Permission.VIEW_DASHBOARD,
        isNew: true,
      },
      {
        name: 'Deal Settings',
        href: '/promotions/settings',
        icon: Settings,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'Loyalty Points',
        href: '/promotions/loyalty',
        icon: Coins,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
    ],
  },
  {
    title: 'Support & Operations',
    items: [
      {
        name: 'Users',
        href: '/support/users',
        icon: Users,
        requiredPermission: Permission.VIEW_USERS,
      },
      {
        name: 'Merchant Partners',
        href: '/support/merchants',
        icon: Store,
        requiredPermission: Permission.VIEW_MERCHANTS,
      },
      {
        name: 'User Activity',
        href: '/support/user-activity',
        icon: History,
        requiredPermission: Permission.VIEW_AUDIT_LOGS,
      },
      {
        name: 'User Devices',
        href: '/support/devices',
        icon: Smartphone,
        requiredPermission: Permission.VIEW_USERS,
      },
      {
        name: 'Disputes',
        href: '/support/disputes',
        icon: HelpCircle,
        requiredPermission: Permission.VIEW_USERS,
      },
    ],
  },
  {
    title: 'System & Security',
    items: [
      {
        name: 'Approvals',
        href: '/system/approvals',
        icon: CheckSquare,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'System Settings',
        href: '/system/settings',
        icon: Settings,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
      {
        name: 'Admins',
        href: '/system/admins',
        icon: ShieldCheck,
        requiredPermission: Permission.CREATE_ADMINS,
      },
      {
        name: 'Roles & Permissions',
        href: '/system/roles',
        icon: Database,
        requiredPermission: Permission.MANAGE_SYSTEM_ROLES,
      },
      {
        name: 'System Outbox',
        href: '/system/outbox',
        icon: Send,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
    ],
  },
  {
    title: 'Reporting',
    items: [
      {
        name: 'Audit Logs',
        href: '/audit',
        icon: FileText,
        requiredPermission: Permission.VIEW_AUDIT_LOGS,
      },
      {
        name: 'Reports',
        href: '/reports',
        icon: BarChart3,
        requiredPermission: Permission.VIEW_DASHBOARD,
      },
    ],
  },
];

export function Sidebar({
  onLogout,
  onToggle,
  isCollapsed = false,
  userRole = 'SUPPORT_STAFF',
  permissions = [],
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'border-r border-border flex-col flex h-full transition-all duration-300 ease-in-out bg-gradient-to-b from-sidebar-gradient-from via-sidebar-gradient-via to-sidebar-gradient-to text-foreground select-none',
        // Desktop Layout
        'lg:flex',
        isCollapsed ? 'lg:w-20' : 'lg:w-64',
        // Mobile Drawer Layout
        'fixed inset-y-0 left-0 z-50 w-64 lg:static lg:translate-x-0',
        mobileOpen
          ? 'translate-x-0 shadow-2xl'
          : '-translate-x-full lg:translate-x-0',
      )}
    >
      <div
        className={cn(
          'h-16 flex items-center justify-between border-b border-border/50 flex-shrink-0 transition-all duration-300 px-6',
          isCollapsed && !mobileOpen && 'lg:px-0 lg:justify-center',
        )}
      >
        {!isCollapsed || mobileOpen ? (
          <div className="flex items-center">
            <img
              src="/logo/logo.png"
              alt="P-wallet"
              className="h-8 w-auto object-contain"
            />
            <span className="ml-3 text-xl font-bold text-foreground tracking-tight animate-in fade-in duration-500">
              P-wallet
            </span>
          </div>
        ) : (
          <img
            src="/logo/logo.png"
            alt="P-wallet"
            className="h-8 w-8 object-contain"
          />
        )}

        {/* Dynamic Desktop Hamburger vs Mobile Close button */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/50 hidden lg:flex"
            aria-label="Toggle Sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {onMobileClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMobileClose}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 lg:hidden"
              aria-label="Close Sidebar"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      <nav className="flex-1 px-3 py-6 space-y-8 overflow-y-auto custom-scrollbar text-pretty">
        {navigationGroups.map((group) => {
          // Filter items based on role and permissions
          const filteredItems = group.items.filter((item) => {
            if (userRole === 'SUPER_ADMIN') return true;
            const rolePass = !item.roles || item.roles.includes(userRole);
            const permissionPass =
              !item.requiredPermission ||
              permissions.includes(item.requiredPermission);
            return rolePass && permissionPass;
          });

          if (filteredItems.length === 0) return null;

          return (
            <div key={group.title} className="space-y-2">
              {(!isCollapsed || mobileOpen) && (
                <h3 className="px-4 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2">
                  {group.title}
                </h3>
              )}
              <div className="space-y-1">
                {filteredItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/' &&
                      pathname.startsWith(item.href + '/') &&
                      !navigationGroups
                        .flatMap((g) => g.items)
                        .some(
                          (other) =>
                            other.href !== item.href &&
                            other.href.startsWith(item.href + '/') &&
                            pathname.startsWith(other.href),
                        ));
                  return (
                    <Link
                      key={item.name}
                      href={item.isSoon ? '#' : item.href}
                      title={isCollapsed && !mobileOpen ? item.name : ''}
                      onClick={(e) => {
                        if (item.isSoon) {
                          e.preventDefault();
                        } else {
                          onMobileClose?.();
                        }
                      }}
                      className={cn(
                        'flex items-center rounded-xl transition-all duration-200 group',
                        isCollapsed && !mobileOpen
                          ? 'justify-center px-0 py-3'
                          : 'px-4 py-2',
                        isActive
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-xs dark:bg-indigo-500/20'
                          : item.isSoon
                            ? 'text-muted-foreground/40 cursor-not-allowed opacity-50'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <item.icon
                        className={cn(
                          'flex-shrink-0 transition-colors',
                          isCollapsed && !mobileOpen
                            ? 'h-6 w-6'
                            : 'mr-3 h-4 w-4',
                          isActive
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : item.isSoon
                              ? 'text-muted-foreground/30'
                              : 'text-muted-foreground group-hover:text-foreground',
                        )}
                        aria-hidden="true"
                      />
                      {(!isCollapsed || mobileOpen) && (
                        <div className="flex items-center justify-between flex-1 min-w-0">
                          <span
                            className={cn(
                              'text-sm font-semibold truncate animate-in fade-in slide-in-from-left-2 duration-300',
                              item.isSoon && 'text-muted-foreground/40',
                            )}
                          >
                            {item.name}
                          </span>
                          {item.isNew && !item.isSoon && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-pink)] text-[8px] font-bold text-white tracking-tighter animate-pulse shadow-sm">
                              NEW
                            </span>
                          )}
                          {item.isSoon && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[8px] font-bold text-slate-400 tracking-tighter border border-slate-200 dark:border-slate-700 uppercase">
                              SOON
                            </span>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          'p-4 border-t border-border/50 flex-shrink-0 transition-all duration-300',
          isCollapsed && !mobileOpen ? 'flex justify-center' : '',
        )}
      >
        <form
          action={onLogout}
          className="w-full"
          onSubmit={() => onMobileClose?.()}
        >
          <Button
            type="submit"
            variant="ghost"
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground w-full transition-all cursor-pointer',
              isCollapsed && !mobileOpen
                ? 'px-0 justify-center'
                : 'justify-start',
            )}
          >
            <LogOut
              className={cn(
                'flex-shrink-0',
                isCollapsed && !mobileOpen
                  ? 'h-6 w-6'
                  : 'mr-3 w-5 h-5 text-muted-foreground',
              )}
            />
            {(!isCollapsed || mobileOpen) && (
              <span className="font-semibold text-sm">Sign out</span>
            )}
          </Button>
        </form>
      </div>
    </aside>
  );
}
