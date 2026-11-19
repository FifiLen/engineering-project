'use client';

/**
 * Ekran „Strefy” (D2, ADR 0047, makiety 23-panel-strefy): lista na kontrakcie list po lewej, mapa
 * z warstwami stref i hulajnogami, edytor geometrii Terra Draw i karta edycji nad mapą. Stan listy
 * i wybrana strefa (`strefa=<id>` albo `strefa=nowa`) są w adresie URL.
 *
 * Cofanie (ADR 0047): każda zakończona operacja edytora odkłada kopię poprzedniego wielokąta na stos
 * (najwyżej 50 kopii); „Cofnij” i Ctrl+Z zdejmują ostatnią. Cofanie dotyczy tylko niezapisanych zmian.
 */
import {
  auditLogResource,
  parseListQuery,
  toSearchParams,
  zonesResource,
  type FleetMapScooter,
  type ListQuery,
  type ListResponse,
  type ZoneDetails,
  type ZoneImpactRental,
  type ZoneInput,
  type ZoneListItem,
  type ZonePolygon,
  type ZonesChanged,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError, errorMessage } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { AREA_PATHS } from '../areas';
import { ListIcon, PencilIcon, PlusIcon, TrashIcon, UndoIcon } from '../icons';
import { ExportButton, exportParams, exportScope } from '../list-export';
import { ZoneCard, type FieldErrors, type GeometryProblem, type ZoneForm } from './zone-card';
import { ZoneImpactDialog, ZoneRemovalDialog, type ImpactChange } from './zone-dialogs';
import {
  outerRings,
  pointInGeometry,
  ringAreaM2,
  ringOf,
  ringsOverlap,
  samePolygon,
  toZonePolygon,
} from './zone-geometry';
import { ZoneList, type ListState } from './zone-list';
import { ZoneMap, type EditorTool, type ZoneMapApi, type ZonesGeoJson } from './zone-map';

/** Kolumny eksportu stref (ADR 0073): bez geometrii (GeoJSON stref poza zakresem iteracji 8). */
const ZONE_EXPORT_COLUMNS = [
  'code',
  'name',
  'type',
  'active',
  'visibleInApp',
  'speedLimitKmh',
  'capacity',
  'areaM2',
  'scootersInside',
  'ridesInside',
  'updatedAt',
  'updatedByName',
] as const;

const SELECTION_PARAM = 'strefa';
const NEW_ZONE = 'nowa';
const UNDO_LIMIT = 50;
const FACETS = ['type', 'active'];
const SPEED_MIN = 5;
const SPEED_MAX = 15;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const GEOMETRY_ERRORS = ['ZONE_OUTSIDE_SERVICE_AREA', 'ZONE_OVERLAP', 'ZONE_INVALID_GEOMETRY'] as const;
type GeometryErrorCode = (typeof GEOMETRY_ERRORS)[number];

const EMPTY_FORM: ZoneForm = { code: '', name: '', type: null, speedLimitKmh: '', capacity: '', visibleInApp: true };

const formOf = (d: ZoneDetails): ZoneForm => ({
  code: d.code,
  name: d.name,
  type: d.type,
  speedLimitKmh: d.speedLimitKmh === null ? '' : String(d.speedLimitKmh),
  capacity: d.capacity === null ? '' : String(d.capacity),
  visibleInApp: d.visibleInApp,
});

const sameForm = (a: ZoneForm, b: ZoneForm) =>
  a.code.trim() === b.code.trim() &&
  a.name.trim() === b.name.trim() &&
  a.type === b.type &&
  a.speedLimitKmh === b.speedLimitKmh &&
  a.capacity === b.capacity &&
  a.visibleInApp === b.visibleInApp;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface ServerGeometryError {
  code: GeometryErrorCode;
  reason: string | null;
  zoneCode: string | null;
}

export function ZonesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useSession();
  const canWrite = can(zonesResource.permissions.write);
  const canSeeFleet = can('scooters.read');

  // ---------------------------------------------------------------------------------------------
  // Lista: stan w adresie URL (bez parametru wybranej strefy)
  // ---------------------------------------------------------------------------------------------
  const selection = searchParams.get(SELECTION_PARAM);
  const listParams = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.delete(SELECTION_PARAM);
    return params;
  }, [searchParams]);
  const query = useMemo<ListQuery>(() => {
    const parsed = parseListQuery(zonesResource, listParams);
    if (parsed.ok) return parsed.query;
    const fallback = parseListQuery(zonesResource, {});
    return fallback.ok ? fallback.query : { filters: [], sort: [], page: 1, pageSize: 25, facets: [] };
  }, [listParams]);
  const activeFilter = query.filters.find((f) => f.field === 'active');
  const active = activeFilter ? activeFilter.values[0] !== false : true;
  const requestParams = toSearchParams(zonesResource, {
    ...query,
    filters: activeFilter ? query.filters : [...query.filters, { field: 'active', op: 'eq', values: [true] }],
    facets: FACETS,
  }).toString();

  const [listState, setListState] = useState<ListState>({ status: 'loading' });
  const [listReload, setListReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setListState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api<ListResponse<ZoneListItem>>(`/admin/zones?${requestParams}`, { signal: controller.signal })
      .then((data) => setListState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError')
          setListState({ status: 'error', code: error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR' });
      });
    return () => controller.abort();
  }, [requestParams, listReload]);

  const replaceUrl = useCallback(
    (params: URLSearchParams, zone: string | null) => {
      if (zone) params.set(SELECTION_PARAM, zone);
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const navigate = useCallback(
    (next: Partial<ListQuery>) =>
      replaceUrl(toSearchParams(zonesResource, { ...query, page: 1, ...next, facets: [] }), selection),
    [query, selection, replaceUrl],
  );

  // ---------------------------------------------------------------------------------------------
  // Strefy na mapie i hulajnogi
  // ---------------------------------------------------------------------------------------------
  const [zones, setZones] = useState<ZonesGeoJson | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const loadZones = useCallback(() => {
    api<ZonesGeoJson>('/zones')
      .then((z) => {
        setZones(z);
        setZonesError(null);
      })
      .catch((e: unknown) => setZonesError(errorMessage(e)));
  }, []);
  useEffect(loadZones, [loadZones]);

  const [scooters, setScooters] = useState<Map<string, FleetMapScooter>>(new Map());
  const loadFleet = useCallback(() => {
    if (!canSeeFleet) return;
    api<FleetMapScooter[]>('/admin/fleet/map')
      .then((list) => setScooters(new Map(list.map((s) => [s.id, s]))))
      .catch(() => undefined);
  }, [canSeeFleet]);
  useEffect(loadFleet, [loadFleet]);
  const scooterList = useMemo(() => [...scooters.values()], [scooters]);

  // ---------------------------------------------------------------------------------------------
  // Wybrana strefa i formularz
  // ---------------------------------------------------------------------------------------------
  const isNew = selection === NEW_ZONE;
  const selectedId = selection && !isNew ? selection : null;
  const [details, setDetails] = useState<ZoneDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneForm>(EMPTY_FORM);
  const [polygon, setPolygon] = useState<ZonePolygon | null>(null);
  const [savedPolygon, setSavedPolygon] = useState<ZonePolygon | null>(null);
  const undoStack = useRef<Array<ZonePolygon | null>>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [tool, setTool] = useState<EditorTool>('edit');
  const [drawingPoints, setDrawingPoints] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverGeometryError, setServerGeometryError] = useState<ServerGeometryError | null>(null);
  const [clientIssue, setClientIssue] = useState<'SELF_INTERSECTION' | 'TOO_FEW_POINTS' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ZoneDetails | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: 'deactivate' | 'delete' } | { kind: 'impact'; rentals: ZoneImpactRental[]; change: ImpactChange } | null
  >(null);
  const mapApi = useRef<ZoneMapApi | null>(null);
  // Strefa otwarta z adresu URL albo z listy: mapa pokazuje jej granicę po wczytaniu.
  const fitOnLoad = useRef(selection !== null && selection !== NEW_ZONE);

  const clearMessages = () => {
    setFieldErrors({});
    setServerGeometryError(null);
    setClientIssue(null);
    setFormError(null);
    setConflict(null);
    setRemoteChanged(false);
  };

  const resetFrom = useCallback((d: ZoneDetails | null) => {
    const saved = d?.polygon ? toZonePolygon(d.polygon) : null;
    setDetails(d);
    setForm(d ? formOf(d) : EMPTY_FORM);
    setPolygon(saved);
    setSavedPolygon(saved);
    undoStack.current = [];
    setUndoCount(0);
    setTool(d ? 'edit' : 'draw');
    setDrawingPoints(0);
    setFieldErrors({});
    setServerGeometryError(null);
    setClientIssue(null);
    setFormError(null);
    setConflict(null);
    setRemoteChanged(false);
  }, []);

  const loadDetails = useCallback(
    (id: string) =>
      api<ZoneDetails>(`/admin/zones/${id}`)
        .then((d) => {
          setLoadError(null);
          resetFrom(d);
          if (fitOnLoad.current) {
            fitOnLoad.current = false;
            mapApi.current?.fit(outerRings(d.geometry).flat());
          }
        })
        .catch((e: unknown) => {
          setDetails(null);
          setLoadError(errorMessage(e));
        }),
    [resetFrom],
  );

  // Komunikat „Utworzono strefę” przetrwa przejście z `strefa=nowa` na identyfikator zapisanej strefy.
  const keepNotice = useRef(false);
  useEffect(() => {
    if (selectedId) void loadDetails(selectedId);
    else {
      setLoadError(null);
      resetFrom(null);
    }
    if (!keepNotice.current) setNotice(null);
    keepNotice.current = false;
  }, [selectedId, isNew, loadDetails, resetFrom]);

  // Komunikat o zapisie znika po chwili.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const geometryEditable = canWrite && (isNew || (details !== null && details.polygon !== null));
  const dirty = isNew
    ? polygon !== null || form.code.trim() !== '' || form.name.trim() !== '' || form.type !== null
    : details !== null && (!sameForm(form, formOf(details)) || !samePolygon(polygon, savedPolygon));

  const select = (zone: string | null, fit = false) => {
    if (zone === selection) return;
    if (dirty && !window.confirm(t('zones.card.discardConfirm'))) return;
    fitOnLoad.current = fit;
    replaceUrl(new URLSearchParams(listParams), zone);
  };

  // ---------------------------------------------------------------------------------------------
  // Edytor geometrii: zmiany, cofanie, przywrócenie granicy
  // ---------------------------------------------------------------------------------------------
  const pushUndo = (previous: ZonePolygon | null) => {
    undoStack.current.push(previous);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  };

  const onPolygonChange = (next: ZonePolygon, kind: 'draw' | 'edit') => {
    if (samePolygon(next, polygon)) return;
    pushUndo(polygon);
    setPolygon(next);
    setServerGeometryError(null);
    setClientIssue(null);
    if (kind === 'draw') setTool('edit');
  };

  const undo = () => {
    if (mapApi.current?.undoDrawing()) return;
    if (undoStack.current.length === 0) return;
    const previous = undoStack.current.pop() ?? null;
    setUndoCount(undoStack.current.length);
    setPolygon(previous);
    setServerGeometryError(null);
    setClientIssue(null);
    if (previous === null) setTool('draw');
  };

  const resetBoundary = () => {
    setPolygon(savedPolygon);
    undoStack.current = [];
    setUndoCount(0);
    setServerGeometryError(null);
    setClientIssue(null);
    setTool('edit');
  };

  // Ctrl+Z (Cmd+Z) poza polami formularza cofa ostatnią zmianę granicy.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    if (!geometryEditable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || isTyping(e.target)) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [geometryEditable]);

  // ---------------------------------------------------------------------------------------------
  // Pochodne: obszar działania, nakładanie, błędy geometrii i wyróżnienia na mapie
  // ---------------------------------------------------------------------------------------------
  const serviceArea = zones?.features.find((f) => f.properties.type === 'SERVICE_AREA') ?? null;

  const outsidePoints = useMemo(() => {
    if (!polygon || !serviceArea || serverGeometryError?.code !== 'ZONE_OUTSIDE_SERVICE_AREA') return [];
    if (form.type === 'SERVICE_AREA') return [];
    return ringOf(polygon)
      .slice(0, -1)
      .filter((p) => !pointInGeometry(p, serviceArea.geometry));
  }, [polygon, serviceArea, serverGeometryError, form.type]);

  const overlaps = useMemo(() => {
    if (form.type !== 'SLOW' || !polygon || !zones) return [];
    const ring = ringOf(polygon);
    return zones.features
      .filter((f) => f.properties.type === 'PARKING' && f.id !== selectedId)
      .filter((f) => outerRings(f.geometry).some((r) => ringsOverlap(ring, r)))
      .map((f) => `${f.properties.code} ${f.properties.name}`);
  }, [form.type, polygon, zones, selectedId]);

  const geometryProblem: GeometryProblem | null = useMemo(() => {
    if (serverGeometryError) {
      const { code, reason, zoneCode } = serverGeometryError;
      const areaCode = serviceArea?.properties.code ?? '';
      let message: string;
      if (code === 'ZONE_OUTSIDE_SERVICE_AREA')
        message =
          form.type === 'SERVICE_AREA' && zoneCode
            ? t('zones.errors.areaExcludes', { zone: zoneCode })
            : outsidePoints.length > 0
              ? t('zones.errors.outside', { count: outsidePoints.length, area: areaCode })
              : t('zones.errors.outsideEdges', { area: areaCode });
      else if (code === 'ZONE_OVERLAP') message = t('zones.errors.overlap', { zone: zoneCode ?? '' });
      else
        message = t.has(`zones.errors.invalid.${reason}`)
          ? t.dynamic(`zones.errors.invalid.${reason}`)
          : t('error.ZONE_INVALID_GEOMETRY');
      return { message, code };
    }
    if (clientIssue) return { message: t.dynamic(`zones.errors.client.${clientIssue}`), code: null };
    return null;
  }, [serverGeometryError, clientIssue, outsidePoints, serviceArea, form.type]);

  const conflictZoneId = useMemo(() => {
    const code = serverGeometryError?.zoneCode ?? null;
    const relevant =
      serverGeometryError?.code === 'ZONE_OVERLAP' ||
      (serverGeometryError?.code === 'ZONE_OUTSIDE_SERVICE_AREA' && form.type === 'SERVICE_AREA');
    const feature = relevant && code ? zones?.features.find((f) => f.properties.code === code) : undefined;
    return feature?.id !== undefined ? String(feature.id) : null;
  }, [serverGeometryError, form.type, zones]);

  const highlights = useMemo(
    () => ({
      points: outsidePoints,
      zoneId: conflictZoneId,
      invalid: Boolean(serverGeometryError) || clientIssue === 'SELF_INTERSECTION',
    }),
    [outsidePoints, conflictZoneId, serverGeometryError, clientIssue],
  );

  // ---------------------------------------------------------------------------------------------
  // Zapis
  // ---------------------------------------------------------------------------------------------
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!CODE_PATTERN.test(form.code.trim().toUpperCase())) errors.code = t('zones.errors.code');
    if (!form.name.trim()) errors.name = t('zones.errors.name');
    if (!form.type) errors.type = t('zones.errors.type');
    if (form.type === 'SLOW') {
      const kmh = Number(form.speedLimitKmh);
      if (!form.speedLimitKmh || !Number.isInteger(kmh) || kmh < SPEED_MIN || kmh > SPEED_MAX)
        errors.speedLimitKmh = t('zones.errors.speed', { min: SPEED_MIN, max: SPEED_MAX });
    }
    if (form.type === 'PARKING' && form.capacity && !(Number(form.capacity) >= 1))
      errors.capacity = t('zones.errors.capacity');
    return errors;
  };

  const payload = (): ZoneInput | null => {
    if (!form.type || !polygon) return null;
    return {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      speedLimitKmh: form.type === 'SLOW' ? Number(form.speedLimitKmh) : null,
      capacity: form.type === 'PARKING' && form.capacity ? Number(form.capacity) : null,
      visibleInApp: form.type === 'SERVICE_AREA' ? true : form.visibleInApp,
      polygon,
    };
  };

  const handleError = async (error: unknown) => {
    if (!(error instanceof ApiRequestError)) {
      setFormError(errorMessage(error));
      return;
    }
    const detailsRecord =
      typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {};
    if (error.code === 'CONFLICT' && details) {
      setConflict(await api<ZoneDetails>(`/admin/zones/${details.id}`).catch(() => null));
      return;
    }
    if ((GEOMETRY_ERRORS as readonly string[]).includes(error.code)) {
      setServerGeometryError({
        code: error.code as GeometryErrorCode,
        reason: typeof detailsRecord.reason === 'string' ? detailsRecord.reason : null,
        zoneCode: typeof detailsRecord.zoneCode === 'string' ? detailsRecord.zoneCode : null,
      });
      return;
    }
    if (error.code === 'VALIDATION_FAILED' || error.code === 'VALIDATION_ERROR') {
      // VALIDATION_FAILED (core) ma listę pól, VALIDATION_ERROR (Zod) listę problemów ze ścieżką.
      const fields = Array.isArray(detailsRecord.fields)
        ? (detailsRecord.fields as string[])
        : Array.isArray(error.details)
          ? (error.details as Array<{ path?: Array<string | number> }>).map((i) => String(i.path?.[0] ?? ''))
          : [];
      const next: FieldErrors = {};
      if (fields.includes('code')) next.code = t('zones.errors.code');
      if (fields.includes('name')) next.name = t('zones.errors.name');
      if (fields.includes('speedLimitKmh'))
        next.speedLimitKmh = t('zones.errors.speed', { min: SPEED_MIN, max: SPEED_MAX });
      if (fields.includes('capacity')) next.capacity = t('zones.errors.capacity');
      if (fields.includes('polygon'))
        setServerGeometryError({ code: 'ZONE_INVALID_GEOMETRY', reason: 'TOO_FEW_POINTS', zoneCode: null });
      if (Object.keys(next).length) setFieldErrors(next);
      else if (!fields.includes('polygon')) setFormError(errorMessage(error));
      return;
    }
    if (error.code === 'ALREADY_EXISTS') {
      setFieldErrors({ code: t('zones.errors.codeTaken') });
      return;
    }
    setFormError(errorMessage(error));
  };

  /** Zmiana, przed którą trzeba sprawdzić przejazdy w trakcie (limit, granica, widoczność). */
  const impactChange = (): ImpactChange | null => {
    if (isNew) return form.type === 'SLOW' || form.type === 'NO_RIDE' ? { kind: 'new' } : null;
    if (!details?.active) return null;
    if (form.type === 'SLOW' && String(details.speedLimitKmh ?? '') !== form.speedLimitKmh)
      return { kind: 'limit', from: details.speedLimitKmh, to: Number(form.speedLimitKmh) };
    if (!samePolygon(polygon, savedPolygon)) return { kind: 'geometry' };
    if (form.visibleInApp !== details.visibleInApp && form.type !== 'SERVICE_AREA')
      return { kind: 'visibility', visible: form.visibleInApp };
    return null;
  };

  const save = async (confirmed = false) => {
    clearMessages();
    setDialog(null);
    const errors = validate();
    const body = payload();
    if (Object.keys(errors).length > 0 || !body) {
      setFieldErrors(errors);
      if (!polygon) setClientIssue('TOO_FEW_POINTS');
      return;
    }
    setSaving(true);
    try {
      if (!confirmed) {
        const change = impactChange();
        if (change) {
          const changedPolygon = isNew || !samePolygon(polygon, savedPolygon) ? polygon : null;
          const rentals = await api<ZoneImpactRental[]>(
            isNew ? '/admin/zones/impact' : `/admin/zones/${details!.id}/impact`,
            {
              method: 'POST',
              json: { polygon: changedPolygon },
            },
          );
          if (rentals.length > 0) {
            setDialog({ kind: 'impact', rentals, change });
            return;
          }
        }
      }
      const saved = isNew
        ? await api<ZoneDetails>('/admin/zones', { method: 'POST', json: body })
        : await api<ZoneDetails>(`/admin/zones/${details!.id}`, {
            method: 'PATCH',
            json: { ...body, version: details!.version },
          });
      resetFrom(saved);
      setNotice(
        isNew ? t('zones.card.created', { code: saved.code }) : t('zones.card.saved', { version: saved.version }),
      );
      setListReload((n) => n + 1);
      loadZones();
      if (isNew) {
        keepNotice.current = true;
        replaceUrl(new URLSearchParams(listParams), saved.id);
      }
    } catch (error) {
      await handleError(error);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (activate: boolean) => {
    if (!details) return;
    clearMessages();
    try {
      const saved = await api<ZoneDetails>(`/admin/zones/${details.id}/${activate ? 'restore' : 'deactivate'}`, {
        method: 'POST',
        json: { version: details.version },
      });
      setDialog(null);
      resetFrom(saved);
      setNotice(activate ? t('zones.card.restored') : t('zones.card.deactivated'));
      setListReload((n) => n + 1);
      loadZones();
    } catch (error) {
      setDialog(null);
      await handleError(error);
    }
  };

  const remove = async () => {
    if (!details) return;
    clearMessages();
    try {
      await api(`/admin/zones/${details.id}?version=${details.version}`, { method: 'DELETE' });
      setDialog(null);
      resetFrom(null);
      setListReload((n) => n + 1);
      loadZones();
      replaceUrl(new URLSearchParams(listParams), null);
    } catch (error) {
      setDialog(null);
      await handleError(error);
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Na żywo: zmiany stref (lista, mapa, otwarta karta) i pozycje floty
  // ---------------------------------------------------------------------------------------------
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ selectedId, dirty, saving, loadDetails });
  latest.current = { selectedId, dirty, saving, loadDetails };
  const onZonesChanged = useCallback(
    (event: ZonesChanged) => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => {
        setListReload((n) => n + 1);
        loadZones();
      }, 300);
      const { selectedId: open, dirty: unsaved, saving: busy, loadDetails: reload } = latest.current;
      if (!open || busy || !event.zoneIds.includes(open)) return;
      // Otwarty formularz ze zmianami nie jest nadpisywany; zapis skończy się konfliktem wersji (ADR 0047).
      if (unsaved) setRemoteChanged(true);
      else void reload(open);
    },
    [loadZones],
  );
  const onFleet = useCallback((updates: FleetMapScooter[]) => {
    setScooters((current) => {
      const next = new Map(current);
      for (const u of updates) next.set(u.id, { ...next.get(u.id), ...u });
      return next;
    });
  }, []);
  useStaffFeed({
    zones: onZonesChanged,
    fleet: canSeeFleet ? onFleet : undefined,
    reconnected: () => {
      setListReload((n) => n + 1);
      loadZones();
      loadFleet();
    },
  });
  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );

  // ---------------------------------------------------------------------------------------------
  // Widok
  // ---------------------------------------------------------------------------------------------
  const conflictView = conflict
    ? {
        version: conflict.version,
        differences: [
          conflict.name !== form.name || conflict.code !== form.code
            ? t('zones.card.diffName', { value: `${conflict.code} ${conflict.name}` })
            : null,
          String(conflict.speedLimitKmh ?? '') !== form.speedLimitKmh && form.type === 'SLOW'
            ? t('zones.card.diffLimit', { value: conflict.speedLimitKmh ?? 0 })
            : null,
          String(conflict.capacity ?? '') !== form.capacity && form.type === 'PARKING'
            ? t('zones.card.diffCapacity', { value: conflict.capacity ?? t('common.none') })
            : null,
          conflict.visibleInApp !== form.visibleInApp ? t('zones.card.diffVisible') : null,
          conflict.polygon && !samePolygon(toZonePolygon(conflict.polygon), polygon)
            ? t('zones.card.diffGeometry')
            : null,
          conflict.active !== details?.active ? t('zones.card.diffActive') : null,
        ].filter((d): d is string => d !== null),
      }
    : null;

  const showCard = isNew || details !== null;
  const editorVisible = geometryEditable && showCard;

  return (
    <div className="zones-page">
      <ZoneList
        query={query}
        active={active}
        state={listState}
        selectedId={selectedId}
        draftPoints={isNew ? (polygon ? ringOf(polygon).length - 1 : drawingPoints) : null}
        canWrite={canWrite}
        onNavigate={navigate}
        onOpen={(id) => select(id, true)}
        onCreate={() => select(NEW_ZONE)}
        onRetry={() => setListReload((n) => n + 1)}
        tools={
          <>
            <Link className="btn" href={AREA_PATHS.zonePresence}>
              <ListIcon size={16} />
              {t('zoneLists.openLists')}
            </Link>
            <ExportButton
              resource={zonesResource}
              params={exportParams(zonesResource, {
                ...query,
                filters: activeFilter ? query.filters : [...query.filters, { field: 'active', op: 'eq', values: [true] }],
              })}
              rows={listState.status === 'ready' ? listState.data.total : null}
              {...exportScope(zonesResource, {
                ...query,
                filters: activeFilter ? query.filters : [...query.filters, { field: 'active', op: 'eq', values: [true] }],
              })}
              columns={ZONE_EXPORT_COLUMNS}
            />
          </>
        }
      />

      <div className="zones-map">
        <ZoneMap
          zones={zones}
          scooters={scooterList}
          selectedId={selectedId}
          readonlyGeometry={details && !geometryEditable ? details.geometry : null}
          polygon={showCard ? polygon : null}
          previousPolygon={savedPolygon}
          editable={editorVisible}
          tool={tool}
          zoneType={form.type}
          highlights={highlights}
          apiRef={mapApi}
          onSelect={(id) => select(id)}
          onPolygonChange={onPolygonChange}
          onDrawingProgress={setDrawingPoints}
          onInvalidEdit={setClientIssue}
        />

        {editorVisible && (
          <div className="zm-toolbar glass-zone" role="toolbar" aria-label={t('zones.map.toolbar')}>
            <button type="button" className="zm-tool" aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}>
              <PlusIcon size={15} />
              {t('zones.map.draw')}
            </button>
            <button
              type="button"
              className="zm-tool"
              aria-pressed={tool === 'edit'}
              disabled={!polygon}
              onClick={() => setTool('edit')}
            >
              <PencilIcon />
              {t('zones.map.edit')}
            </button>
            <button
              type="button"
              className="zm-tool"
              aria-pressed={tool === 'delete'}
              disabled={!polygon}
              onClick={() => setTool('delete')}
            >
              <TrashIcon />
              {t('zones.map.deletePoint')}
            </button>
            <span className="zm-sep" aria-hidden="true" />
            <button
              type="button"
              className="zm-tool icon"
              title={t('zones.map.undo')}
              aria-label={t('zones.map.undo')}
              disabled={undoCount === 0 && drawingPoints === 0}
              onClick={undo}
            >
              <UndoIcon />
            </button>
          </div>
        )}
        {editorVisible && tool === 'draw' && (
          <div className="zm-hint glass-zone" role="status">
            <span>
              {t('zones.map.drawHint')} <kbd className="kbd">{t('zones.map.esc')}</kbd> {t('zones.map.drawHintCancel')}
            </span>
          </div>
        )}

        <div className="zm-legend glass-zone" aria-label={t('map.legend')}>
          {(['PARKING', 'SLOW', 'NO_RIDE', 'SERVICE_AREA'] as const).map((type) => (
            <span key={type}>
              <i className={`swatch ${type.toLowerCase()}`} aria-hidden="true" />
              {t.dynamic(`zones.map.legend.${type}`)}
            </span>
          ))}
          {canSeeFleet && (
            <>
              <span>
                <i className="dot" aria-hidden="true" />
                {t('zones.map.legend.scooter')}
              </span>
              <span>
                <i className="dot riding" aria-hidden="true" />
                {t('zones.map.legend.riding')}
              </span>
            </>
          )}
        </div>

        {zonesError && (
          <div className="banner danger map-error" role="alert">
            {t('map.loadError')}
            {': '}
            {zonesError}
          </div>
        )}

        {loadError && selectedId && (
          <div className="zc glass-zone zc-empty" role="alert">
            <p>{loadError}</p>
            <button type="button" className="btn" onClick={() => select(null)}>
              {t('common.close')}
            </button>
          </div>
        )}

        {!showCard && !(loadError && selectedId) && (
          <div className="zm-pick glass-zone" role="status">
            {t('zones.card.selectHint')}
          </div>
        )}

        {showCard && (
          <ZoneCard
            key={details?.id ?? NEW_ZONE}
            details={details}
            form={form}
            onForm={(patch) => {
              setForm((f) => ({ ...f, ...patch }));
              setFieldErrors({});
              setFormError(null);
            }}
            polygon={polygon}
            areaM2={
              details && samePolygon(polygon, savedPolygon)
                ? details.areaM2
                : polygon
                  ? ringAreaM2(ringOf(polygon))
                  : (details?.areaM2 ?? 0)
            }
            drawingPoints={drawingPoints}
            tool={tool}
            canWrite={canWrite}
            geometryEditable={geometryEditable}
            dirty={dirty}
            saving={saving}
            serviceAreaCode={serviceArea?.properties.code ?? null}
            overlaps={overlaps}
            fieldErrors={fieldErrors}
            geometryProblem={geometryProblem}
            geometryRejected={serverGeometryError !== null && !isNew}
            formError={formError}
            notice={notice}
            conflict={conflictView}
            remoteChanged={remoteChanged}
            historyHref={
              details && can(auditLogResource.permissions.read) ? `/admin/dziennik?entityId=${details.id}` : null
            }
            onSave={() => void save()}
            onClose={() => select(null)}
            onShowBoundary={() => {
              const points = polygon ? ringOf(polygon) : details ? outerRings(details.geometry).flat() : [];
              mapApi.current?.fit(points);
            }}
            onResetBoundary={resetBoundary}
            onLoadCurrent={() => details && void loadDetails(details.id)}
            onDeactivate={() => setDialog({ kind: 'deactivate' })}
            onRestore={() => void setActive(true)}
            onDelete={() => setDialog({ kind: 'delete' })}
          />
        )}
      </div>

      {dialog && (dialog.kind === 'deactivate' || dialog.kind === 'delete') && details && (
        <ZoneRemovalDialog
          zone={details}
          mode={dialog.kind}
          onConfirm={() => (dialog.kind === 'delete' ? remove() : setActive(false))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'impact' && (
        <ZoneImpactDialog
          zone={{ code: form.code.trim().toUpperCase() || (details?.code ?? ''), name: form.name.trim() }}
          rentals={dialog.rentals}
          change={dialog.change}
          nextVersion={details ? details.version + 1 : null}
          onConfirm={() => void save(true)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
