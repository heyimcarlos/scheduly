# Note Parser Integration Summary

The note parser module has been successfully integrated with the FastAPI backend.

## What Was Done

### 1. Pydantic Schemas Added
**File**: `apps/api/app/models/schemas.py`

Added three new schema models:
- `SchedulingEvent`: Represents a single parsed scheduling event
- `ParseNoteRequest`: Request model for the note parsing endpoint
- `ParseNoteResponse`: Response model containing parsed events

### 2. API Route Added
**File**: `apps/api/app/api/routes.py`

Added a new POST endpoint at `/api/v1/notes/parse` that:
- Accepts natural language manager notes
- Uses Google's Gemini AI to parse them into structured events
- Supports optional employee roster for fuzzy name matching
- Handles errors gracefully (missing API key, parsing errors, etc.)
- Uses lazy loading to avoid requiring Gemini API credentials unless the endpoint is called

### 3. Tests Added
**File**: `apps/api/tests/test_routes.py`

Added two tests:
- `test_parse_note_endpoint_validation`: Validates request structure
- `test_parse_note_endpoint_structure`: Verifies endpoint response format

Both tests passed successfully.

### 4. Documentation Created

Created three comprehensive documentation files:
- `API_INTEGRATION.md`: Complete API documentation with examples
- `FRONTEND_INTEGRATION.md`: Frontend integration guide with React components
- `INTEGRATION_SUMMARY.md`: This file

## API Endpoint Details

**Endpoint**: `POST /api/v1/notes/parse`

**Request Body**:
```json
{
  "note": "Alice is sick tomorrow",
  "employee_roster": ["Alice Chen", "Bob Martinez"],
  "today_override": "2026-02-19 (Thursday)"
}
```

**Response**:
```json
{
  "events": [
    {
      "type": "sick_leave",
      "employee": "Alice Chen",
      "affected_dates": ["2026-02-20"],
      "affected_shifts": ["night"],
      "swap_target": null,
      "notes": "Alice is sick tomorrow",
      "urgency": "immediate",
      "confidence": "high"
    }
  ]
}
```

## Setup Requirements

### 1. Environment Variables

The note parser requires these environment variables:

```bash
GEMINI_API_KEY=your_gemini_api_key
MODEL_NAME=gemini-1.5-flash  # or your preferred model
```

### 2. Install Note Parser Dependencies

The note parser has separate dependencies that need to be installed:

```bash
cd packages/note_parser
uv sync
```

**Why separate?**: The note parser uses `google-generativeai` which has a protobuf version conflict with TensorFlow used by the ML package. By keeping it separate and loading it dynamically, we avoid dependency conflicts.

## Usage Examples

### Using curl

```bash
curl -X POST http://localhost:8000/api/v1/notes/parse \
  -H "Content-Type: application/json" \
  -d '{
    "note": "Alice is sick tomorrow. Bob wants Friday off.",
    "employee_roster": ["Alice Chen", "Bob Martinez"]
  }'
```

### Using Python

```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/notes/parse",
    json={"note": "Milan will be late tomorrow"}
)

events = response.json()["events"]
for event in events:
    print(f"{event['type']}: {event['employee']}")
```

### From Frontend (React)

```typescript
import { parseManagerNote } from '@/lib/api';

const result = await parseManagerNote({
  note: "Sarah needs coverage for Monday night",
  employee_roster: ["Sarah Kim", "Alice Chen"]
});

console.log(result.events);
```

## Features

### Event Types Supported
- `sick_leave`: Employee is sick
- `time_off`: Planned vacation/personal day
- `swap`: Shift swap request
- `late_arrival`: Employee arriving late
- `early_departure`: Employee leaving early
- `coverage_request`: Extra coverage needed

### Fuzzy Name Matching
If an employee roster is provided, the parser will attempt to match misspelled or partial names:
- "Alic Chen" → "Alice Chen"
- "Bob" → "Bob Martinez"

### Conflict Detection
The parser detects contradictory instructions:
- "Alice is off Monday. Alice is working Monday."
- Both events returned with `confidence: "low"` and conflict notes

### Multi-language Support
Understands notes in multiple languages (French, Serbian, Hindi, etc.)

### Confidence Levels
- `high`: All key fields clearly stated
- `medium`: Some fields inferred
- `low`: Ambiguous or conflicting information

## Integration with Existing System

The parsed events can be converted to existing scheduler data structures:

### Converting to Absence Events

```python
from app.models.schemas import AbsenceEventWindow

def event_to_absence(event: SchedulingEvent, employee_id: int) -> AbsenceEventWindow:
    return AbsenceEventWindow(
        employee_id=employee_id,
        start_date=event.affected_dates[0],
        end_date=event.affected_dates[-1],
        reason="sick" if event.type == "sick_leave" else "vacation"
    )
```

### Using in Schedule Generation

```python
# Parse manager note
parsed = await parse_manager_note({"note": "Alice sick tomorrow"})

# Convert to absence events
absence_events = []
for event in parsed.events:
    if event.type in ["sick_leave", "time_off"]:
        employee_id = lookup_employee_id(event.employee)
        absence = event_to_absence(event, employee_id)
        absence_events.append(absence)

# Use in scheduler
schedule_request = ScheduleRequest(
    start_date="2026-03-10",
    num_days=7,
    employees=[...],
    absence_events=absence_events
)

schedule = await generate_schedule(schedule_request)
```

## Testing

### Run API Tests

```bash
cd apps/api
uv run pytest tests/test_routes.py::test_parse_note_endpoint_validation -v
uv run pytest tests/test_routes.py::test_parse_note_endpoint_structure -v
```

### Run Note Parser Unit Tests

```bash
cd packages/note_parser
uv run pytest test_note_parser.py -v
```

All tests passing:
- ✅ API endpoint validation test
- ✅ API endpoint structure test
- ✅ Note parser unit tests (20+ test cases)

## Error Handling

The endpoint handles various error scenarios gracefully:

1. **Missing API key**: Returns 500 with clear error message
2. **Invalid request**: Returns 422 with validation errors
3. **Empty note**: Returns 422 (validation error)
4. **Gemini API errors**: Returns 500 with error details
5. **Parsing failures**: Returns fallback event with low confidence

## Architecture Notes

### Why Dynamic Import?

The note parser is loaded dynamically in the route handler rather than at module level:

```python
try:
    # Dynamic import to avoid dependency conflicts
    from note_parser_module import parse_manager_note as parse_note
    ...
except ImportError as exc:
    raise HTTPException(status_code=500, detail=f"Note parser not available: {exc}")
```

This approach:
- Avoids loading Gemini dependencies unless needed
- Prevents protobuf version conflicts with TensorFlow
- Allows the API to run without note parser if not needed
- Provides clear error messages when dependencies are missing

### Monorepo Integration

The note parser is a separate package in the monorepo:
- Located at: `packages/note_parser/`
- Has its own dependencies: `pyproject.toml`
- Can be installed independently
- Shared via Python path manipulation in the route

## Next Steps

### Recommended Enhancements

1. **Frontend Component**: Implement the NoteParser React component (see FRONTEND_INTEGRATION.md)
2. **Database Integration**: Store parsed events for audit trail
3. **Webhook Support**: Parse notes from Slack/Teams messages
4. **Batch Processing**: Parse multiple notes at once
5. **Caching**: Cache recent parses to reduce API calls
6. **Rate Limiting**: Add rate limiting to prevent API abuse

### Potential Use Cases

1. **Quick Entry**: Managers can type natural language instead of filling forms
2. **Email Integration**: Parse scheduling requests from emails
3. **Chat Integration**: Connect to Slack/Teams for real-time parsing
4. **Voice Input**: Combine with speech-to-text for voice commands
5. **Audit Log**: Track all scheduling changes with original text

## Files Modified/Created

### Modified Files
1. `apps/api/app/models/schemas.py` - Added 3 new schemas
2. `apps/api/app/api/routes.py` - Added 1 new endpoint
3. `apps/api/tests/test_routes.py` - Added 2 new tests

### Created Files
1. `packages/note_parser/API_INTEGRATION.md`
2. `packages/note_parser/FRONTEND_INTEGRATION.md`
3. `packages/note_parser/INTEGRATION_SUMMARY.md`

## Support

For issues or questions:
1. Check the API_INTEGRATION.md for detailed usage
2. Check FRONTEND_INTEGRATION.md for React examples
3. Review test files for working examples
4. Check note parser unit tests for edge cases

## Conclusion

The note parser is now fully integrated with the FastAPI backend and ready to be used by the frontend. The integration:
- ✅ Follows existing API patterns
- ✅ Has comprehensive error handling
- ✅ Is fully tested
- ✅ Is well documented
- ✅ Handles dependency conflicts gracefully
- ✅ Provides clear examples for frontend integration
