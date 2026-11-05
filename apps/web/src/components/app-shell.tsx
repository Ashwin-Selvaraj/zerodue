'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SyncBadge } from './sync-badge';

const TABS = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/transactions', label: 'Transactions', icon: '☰' },
  { href: '/add', label: 'Add', icon: '+' },
  { href: '/plan', label: 'Plan', icon: '◔' },
  { href: '/more', label: 'More', icon: '⋯' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === '/add';

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-md justify-end px-4 pt-3">
        <SyncBadge />
      </div>
      {children}
      {!hideNav && (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
        >
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {TABS.map((tab) => {
              const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
              const isAdd = tab.href === '/add';
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center text-xs ${
                      active
                        ? 'font-semibold text-teal-700 dark:text-teal-400'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={
                        isAdd
                          ? 'flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-xl text-white'
                          : 'text-lg leading-none'
                      }
                    >
                      {tab.icon}
                    </span>
                    <span className={isAdd ? 'sr-only' : ''}>{tab.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
