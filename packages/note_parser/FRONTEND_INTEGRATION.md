# Frontend Integration Complete ✅

The note parser has been fully integrated with the React frontend!

## What Was Implemented

### 1. API Client Types and Function
**File**: `apps/web/src/lib/api.ts`

Added:
- `SchedulingEvent` interface
- `ParseNoteRequest` interface
- `ParseNoteResponse` interface
- `parseManagerNote()` function

### 2. React Query Hook
**File**: `apps/web/src/hooks/useNoteParser.ts`

Created a custom hook that wraps the API call with React Query for:
- Loading states
- Error handling
- Data management
- Optimistic updates

### 3. UI Component
**File**: `apps/web/src/components/scheduler/NoteParser.tsx`

Created a full-featured component with:
- Textarea for entering notes
- Parse button with loading state
- Error display
- Event cards showing:
  - Event type with icons (sick leave, time off, swap, etc.)
  - Employee name
  - Affected dates
  - Affected shifts
  - Urgency badges (immediate, planned, unknown)
  - Confidence badges (high, medium, low)
  - Additional notes
  - Swap target (if applicable)

### 4. Integration with Manager Page
**File**: `apps/web/src/pages/ManagerRequests.tsx`

Added a new "Quick Entry" tab to the Manager Requests page containing the NoteParser component.

## Component Features

### Visual Design
- Follows existing design system patterns
- Uses shadcn/ui components (Card, Badge, Button, Textarea)
- Color-coded urgency levels:
  - **Immediate**: Red/destructive
  - **Planned**: Blue/default
  - **Unknown**: Gray/secondary
- Confidence indicators:
  - **High**: Solid badge
  - **Medium**: Secondary badge
  - **Low**: Outline badge (with warning background)

### Icons
Each event type has a unique icon:
- 🚫 Sick Leave: `UserX`
- ☕ Time Off: `Coffee`
- 👥 Shift Swap: `Users`
- 🕐 Late Arrival: `Clock`
- 🚪 Early Departure: `LogOut`
- ➕ Coverage Request: `UserPlus`

### User Experience
- Real-time parsing with loading indicator
- Clear error messages
- Toast notification on successful parsing
- Callback support for parent components to process events

## How to Test

### 1. Install Dependencies

```bash
# Install frontend dependencies
cd apps/web
npm install
# or if using pnpm
pnpm install
```

### 2. Set Up Environment Variables

Make sure the backend API URL is configured:

```bash
# apps/web/.env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

And the backend has the Gemini API key:

```bash
# apps/api/.env or set in environment
GEMINI_API_KEY=your_gemini_api_key
MODEL_NAME=gemini-1.5-flash
```

### 3. Start the Backend

```bash
cd apps/api
uv run fastapi dev
```

The API should be running at `http://localhost:8000`

### 4. Start the Frontend

```bash
cd apps/web
npm run dev
# or
pnpm dev
```

The frontend should be running at `http://localhost:5173`

### 5. Navigate to Manager Requests

1. Open your browser to `http://localhost:5173`
2. Log in (if authentication is required)
3. Navigate to the Manager Requests page
4. Click on the "Quick Entry" tab

### 6. Test the Note Parser

Try these example notes:

#### Simple Sick Leave
```
Alice is sick tomorrow night shift
```

Expected: 1 event with type=sick_leave, urgency=immediate, confidence=high

#### Multiple Events
```
Alice is sick tomorrow. Bob wants to swap his Monday day shift with Carlos.
```

Expected: 2 events (sick_leave + swap)

#### Time Off Range
```
Milan will be on vacation from Feb 20 to Feb 25
```

Expected: 1 event with multiple dates

#### Coverage Request
```
We need extra coverage for Saturday evening shift
```

Expected: 1 event with no employee, type=coverage_request

#### Ambiguous Note
```
Someone might need time off next week
```

Expected: 1 event with low confidence

#### Multi-language
```
Milan est malade demain
```

Expected: 1 event, notes will include translation

## Integration Points

### Callback Handler

The NoteParser component accepts an `onEventsProcessed` callback:

```typescript
<NoteParser
  employeeRoster={employeeNames}
  onEventsProcessed={(events) => {
    // Process the parsed events
    events.forEach(event => {
      if (event.type === 'sick_leave' || event.type === 'time_off') {
        // Create absence event
      } else if (event.type === 'swap') {
        // Handle swap request
      }
    });
  }}
/>
```

### Converting Events to Actions

Example conversion to absence events:

```typescript
import { SchedulingEvent, AbsenceEventWindow } from '@/lib/api';

function convertToAbsence(
  event: SchedulingEvent,
  employeeId: number
): AbsenceEventWindow | null {
  if (event.type !== 'sick_leave' && event.type !== 'time_off') {
    return null;
  }

  if (event.affected_dates.length === 0) {
    return null;
  }

  const sortedDates = [...event.affected_dates].sort();

  return {
    employee_id: employeeId,
    start_date: sortedDates[0],
    end_date: sortedDates[sortedDates.length - 1],
    reason: event.type === 'sick_leave' ? 'sick' : 'vacation',
  };
}
```

## Error Handling

The component handles various error scenarios:

1. **Empty Note**: Parse button is disabled
2. **API Errors**: Displayed in red error card
3. **Missing API Key**: Server returns 500, shown in error card
4. **Network Errors**: Caught by React Query and displayed
5. **Parsing Errors**: Fallback event with low confidence

## Accessibility

The component includes:
- Proper semantic HTML
- ARIA labels where needed
- Keyboard navigation support
- Screen reader-friendly structure
- Focus management

## Code Quality

- TypeScript types for all props and data
- Follows existing code patterns
- Uses established UI component library
- Consistent with project style guide
- Proper error boundaries

## Next Steps

### Recommended Enhancements

1. **Employee Roster Integration**: Fetch employee names from Supabase and pass to NoteParser
2. **Action Buttons**: Add "Apply" buttons to event cards to create actual requests/absences
3. **History**: Store parsed notes in database for audit trail
4. **Batch Processing**: Allow parsing multiple notes at once
5. **Templates**: Provide common note templates for quick entry
6. **Keyboard Shortcuts**: Add keyboard shortcuts for power users

### Example: Auto-fetch Employee Roster

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function ManagerRequestsWithRoster() {
  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('name');
      if (error) throw error;
      return data;
    },
  });

  const employeeNames = employees?.map(e => e.name) || [];

  return (
    <NoteParser
      employeeRoster={employeeNames}
      onEventsProcessed={handleEvents}
    />
  );
}
```

### Example: Apply Event Button

Add this to the EventCard component:

```typescript
<Button
  size="sm"
  onClick={() => onApplyEvent(event)}
  className="mt-2"
>
  Apply Event
</Button>
```

With handler:

```typescript
const handleApplyEvent = async (event: SchedulingEvent) => {
  if (event.type === 'sick_leave' || event.type === 'time_off') {
    // Look up employee ID
    const employeeId = await lookupEmployeeId(event.employee);

    if (!employeeId) {
      toast({
        title: 'Employee not found',
        description: `Could not find employee: ${event.employee}`,
        variant: 'destructive',
      });
      return;
    }

    // Create time off request
    const { error } = await supabase
      .from('time_off_requests')
      .insert({
        team_member_id: employeeId,
        start_date: event.affected_dates[0],
        end_date: event.affected_dates[event.affected_dates.length - 1],
        request_type: event.type,
        notes: event.notes,
        status: event.urgency === 'immediate' ? 'approved' : 'pending',
      });

    if (error) {
      toast({
        title: 'Error creating request',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Request created',
        description: 'Time off request has been created successfully',
      });
    }
  }
};
```

## Files Changed/Created

### Modified Files
1. `apps/web/src/lib/api.ts` - Added types and API function
2. `apps/web/src/pages/ManagerRequests.tsx` - Added Quick Entry tab

### Created Files
1. `apps/web/src/hooks/useNoteParser.ts` - React Query hook
2. `apps/web/src/components/scheduler/NoteParser.tsx` - UI component

## Testing Checklist

- [ ] Frontend builds without errors
- [ ] No TypeScript errors
- [ ] Component renders correctly
- [ ] Parse button is disabled when note is empty
- [ ] Parse button shows loading state while parsing
- [ ] Successful parse displays event cards
- [ ] Event cards show all relevant information
- [ ] Badges display correct colors for urgency/confidence
- [ ] Error messages display correctly
- [ ] Toast notifications appear on success
- [ ] Callback is triggered with parsed events
- [ ] Employee roster fuzzy matching works
- [ ] Multi-language notes are handled
- [ ] Low confidence events are highlighted
- [ ] Responsive design works on mobile

## Support

If you encounter any issues:

1. Check browser console for errors
2. Verify API is running and accessible
3. Confirm GEMINI_API_KEY is set in backend
4. Check network tab for API request/response
5. Review backend logs for parsing errors

## Conclusion

The frontend integration is complete and ready to use! The NoteParser component provides an intuitive interface for managers to quickly enter scheduling changes in natural language, with AI automatically extracting structured events that can be processed by the system.

The implementation follows all existing patterns, uses the established design system, and is fully typed with TypeScript. Once dependencies are installed, it should work out of the box with the backend API endpoint.
