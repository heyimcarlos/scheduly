import { Shift, TeamMember } from '@/types/scheduler';
import { ApprovedTimeOff, isShiftOnApprovedTimeOff } from '@/hooks/useApprovedTimeOff';
import { ShiftViolation, ViolationMap } from '@/hooks/useCoverageViolations';

const GROUP_THRESHOLD = 3;

/**
 * Extracts the shift family name from a slot name.
 * Morning1/Morning2/Morning3 → "Morning"
 * Evening1/Evening2 → "Evening"
 * Night1 → "Night"
 * Hybrid1 → "Hybrid"
 * Falls back to "Other" for unknown slot names.
 */
export function getShiftFamily(slotName: string | undefined): string {
  if (!slotName) return 'Other';
  const lower = slotName.toLowerCase();
  if (lower.includes('morning')) return 'Morning';
  if (lower.includes('evening')) return 'Evening';
  if (lower.includes('night')) return 'Night';
  if (lower.includes('hybrid')) return 'Hybrid';
  return 'Other';
}

export interface PositionedDayShift {
  shift: Shift;
  member: TeamMember;
  top: number;
  height: number;
  end: number;
  approvedTimeOff?: ApprovedTimeOff;
  violation?: ShiftViolation;
}

export type CalendarRenderItem =
  | {
    kind: 'single';
    key: string;
    top: number;
    height: number;
    end: number;
    shift: Shift;
    member: TeamMember;
    family?: string; // 'Morning' | 'Evening' | 'Night' | 'Hybrid' | 'Other'
    approvedTimeOff?: ApprovedTimeOff;
    violation?: ShiftViolation;
    columnIndex: number;
    columnCount: number;
  }
  | {
    kind: 'grouped';
    key: string;
    top: number;
    height: number;
    end: number;
    shifts: Shift[];
    members: TeamMember[];
    family?: string; // 'Morning' | 'Evening' | 'Night' | 'Hybrid' | 'Other'
    columnIndex: number;
    columnCount: number;
  };

export function buildPositionedDayShifts({
  shifts,
  getShiftPosition,
  getMemberById,
  approvedTimeOffs,
  violations,
}: {
  shifts: Shift[];
  getShiftPosition: (shift: Shift) => { top: number; height: number } | null;
  getMemberById: (id: string) => TeamMember | undefined;
  approvedTimeOffs: ApprovedTimeOff[];
  violations: ViolationMap;
}): PositionedDayShift[] {
  return shifts.flatMap((shift) => {
    const position = getShiftPosition(shift);
    const member = getMemberById(shift.memberId);

    if (!position || !member) {
      return [];
    }

    return [{
      shift,
      member,
      top: position.top,
      height: position.height,
      end: position.top + position.height,
      approvedTimeOff: isShiftOnApprovedTimeOff(
        shift.memberId,
        shift.startTime,
        shift.endTime,
        approvedTimeOffs,
      ),
      violation: violations[shift.id],
    }];
  });
}

export function buildCalendarRenderItems(
  positionedShifts: PositionedDayShift[],
): CalendarRenderItem[] {
  const groupedBySlot = new Map<string, PositionedDayShift[]>();

  for (const item of positionedShifts) {
    const slotKey = [
      item.top.toFixed(2),
      item.height.toFixed(2),
      item.shift.shiftType,
    ].join(':');
    const current = groupedBySlot.get(slotKey) ?? [];
    current.push(item);
    groupedBySlot.set(slotKey, current);
  }

  const renderItems: CalendarRenderItem[] = [];

  for (const slotItems of groupedBySlot.values()) {
    // Compute family for this group (all items share the same slot, so same family)
    const family = getShiftFamily(slotItems[0].shift.slotName);

    if (slotItems.length >= GROUP_THRESHOLD) {
      renderItems.push({
        kind: 'grouped',
        key: `group-${slotItems.map((item) => item.shift.id).join('-')}`,
        top: slotItems[0].top,
        height: slotItems[0].height,
        end: slotItems[0].end,
        shifts: slotItems.map((item) => item.shift),
        members: slotItems.map((item) => item.member),
        family,
        columnIndex: 0,
        columnCount: 1,
      });
      continue;
    }

    for (const item of slotItems) {
      renderItems.push({
        kind: 'single',
        key: item.shift.id,
        top: item.top,
        height: item.height,
        end: item.end,
        shift: item.shift,
        member: item.member,
        family,
        approvedTimeOff: item.approvedTimeOff,
        violation: item.violation,
        columnIndex: 0,
        columnCount: 1,
      });
    }
  }

  return assignColumns(renderItems);
}

function assignColumns(items: CalendarRenderItem[]): CalendarRenderItem[] {
  const sortedItems = [...items].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    return a.end - b.end;
  });

  const laidOutItems: CalendarRenderItem[] = [];
  let cluster: CalendarRenderItem[] = [];
  let active: Array<{ end: number; columnIndex: number }> = [];
  let clusterEnd = -1;
  let clusterColumnCount = 1;

  const flushCluster = () => {
    for (const item of cluster) {
      item.columnCount = clusterColumnCount;
      laidOutItems.push(item);
    }
    cluster = [];
    active = [];
    clusterEnd = -1;
    clusterColumnCount = 1;
  };

  for (const item of sortedItems) {
    if (cluster.length > 0 && item.top >= clusterEnd) {
      flushCluster();
    }

    active = active.filter((activeItem) => activeItem.end > item.top);
    const usedColumns = new Set(active.map((activeItem) => activeItem.columnIndex));
    let columnIndex = 0;
    while (usedColumns.has(columnIndex)) {
      columnIndex += 1;
    }

    item.columnIndex = columnIndex;
    active.push({ end: item.end, columnIndex });
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
    clusterColumnCount = Math.max(clusterColumnCount, active.length, columnIndex + 1);
  }

  if (cluster.length > 0) {
    flushCluster();
  }

  return laidOutItems;
}
