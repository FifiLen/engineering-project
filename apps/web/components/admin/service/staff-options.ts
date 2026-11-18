'use client';

/**
 * Operatorzy do przypisania zgłoszenia albo zadania. Lista operatorów wymaga `staff.read` (zasób `staff`); bez tego
 * uprawnienia panel proponuje tylko zalogowanego operatora („Przypisz mnie”) i bieżącego wykonawcę.
 */
import type { ListResponse, StaffListItem } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';

export interface StaffOption {
  id: string;
  name: string;
}

let request: Promise<StaffOption[]> | null = null;

export function useStaffOptions(current?: StaffOption | null): StaffOption[] {
  const { staff, can } = useSession();
  const full = can('staff.read');
  const [list, setList] = useState<StaffOption[]>([]);
  useEffect(() => {
    if (!full) return;
    request ??= api<ListResponse<StaffListItem>>('/admin/staff?status=ACTIVE&pageSize=100&sort=name')
      .then((r) => r.items.map(({ id, name }) => ({ id, name })))
      .catch(() => {
        request = null;
        return [];
      });
    let alive = true;
    void request.then((items) => alive && setList(items));
    return () => {
      alive = false;
    };
  }, [full]);
  const options = full ? [...list] : [];
  for (const extra of [{ id: staff.id, name: staff.name }, current]) {
    if (extra && !options.some((o) => o.id === extra.id)) options.push(extra);
  }
  return options;
}
