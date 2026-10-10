import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';
import React from 'react';
import '@testing-library/jest-dom';
import { Permission } from '@repo/dto';

// Mock all lucide icons dynamically using a Proxy to avoid SVGR issues and missing icon exports
jest.mock('lucide-react', () => {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        return (props: any) => <span data-testid={`icon-${String(prop).toLowerCase()}`} {...props} />;
      },
    }
  );
});

describe('Sidebar RBAC Visibility', () => {
  const mockOnLogout = jest.fn();

  it('renders standard links for SUPPORT_STAFF but hides restricted ones', () => {
    render(<Sidebar onLogout={mockOnLogout} userRole="SUPPORT_STAFF" permissions={[Permission.VIEW_DASHBOARD]} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText('System Outbox')).toBeInTheDocument();

    // Restricted links
    expect(screen.queryByText('Admins')).not.toBeInTheDocument();
  });

  it('renders ALL links for SUPER_ADMIN', () => {
    render(<Sidebar onLogout={mockOnLogout} userRole="SUPER_ADMIN" />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Customer Wallets')).toBeInTheDocument();
    expect(screen.getByText('Admins')).toBeInTheDocument();
  });

  it('hides Admins and Wallets for RECONCILER without permissions', () => {
    render(
      <Sidebar
        onLogout={mockOnLogout}
        userRole="RECONCILER"
        permissions={[Permission.VIEW_DASHBOARD, Permission.RUN_RECONCILIATION]}
      />,
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Reconcile')).toBeInTheDocument();

    expect(screen.queryByText('Admins')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer Wallets')).not.toBeInTheDocument();
  });
});
