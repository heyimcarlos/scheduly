# Note Parser API Integration

The note parser has been integrated with the FastAPI backend as a REST endpoint.

## Endpoint

**POST** `/api/v1/notes/parse`

## Description

Parses natural language manager notes into structured scheduling events using Google's Gemini AI.

## Request Body

```json
{
  "note": "Alice is sick tomorrow and won't make her night shift. Bob wants to swap Monday with Carlos.",
  "employee_roster": ["Alice Chen", "Bob Martinez", "Carlos De La Cruz"],
  "today_override": "2026-02-19 (Thursday)"
}
```

### Fields

- `note` (string, required): The manager's free-text note to parse
- `employee_roster` (array of strings, optional): List of known employee names for fuzzy matching
- `today_override` (string, optional): Override today's date for testing (format: "YYYY-MM-DD (DayName)")

## Response

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
    },
    {
      "type": "swap",
      "employee": "Bob Martinez",
      "affected_dates": ["2026-02-23"],
      "affected_shifts": ["day"],
      "swap_target": "Carlos De La Cruz",
      "notes": "Bob wants to swap with Carlos",
      "urgency": "planned",
      "confidence": "high"
    }
  ]
}
```

### Event Types

- `sick_leave`: Employee is sick and unable to work
- `time_off`: Planned time off (vacation, personal day)
- `swap`: Employee wants to swap shifts with another employee
- `late_arrival`: Employee will arrive late
- `early_departure`: Employee needs to leave early
- `coverage_request`: Extra coverage needed (no specific employee)

### Urgency Levels

- `immediate`: Needs immediate attention
- `planned`: Scheduled in advance
- `unknown`: Urgency not specified

### Confidence Levels

- `high`: All key fields (type, employee, dates) are clearly stated
- `medium`: One or more fields were inferred
- `low`: Ambiguous or conflicting information

## Setup Requirements

### Environment Variables

The note parser requires a Gemini API key to function. Set the following environment variables:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
MODEL_NAME=gemini-1.5-flash  # or your preferred Gemini model
```

### Dependencies

The note parser module has its own dependencies that must be installed separately:

```bash
cd packages/note_parser
uv sync
```

**Note:** The note parser uses `google-generativeai` which has a protobuf version conflict with TensorFlow used by the main API. Therefore, it's loaded dynamically only when the endpoint is called, and requires separate installation.

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

### Using Python requests

```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/notes/parse",
    json={
        "note": "Milan will be late for his day shift tomorrow",
        "employee_roster": ["Milan Jovanovic"]
    }
)

events = response.json()["events"]
for event in events:
    print(f"{event['type']}: {event['employee']} on {event['affected_dates']}")
```

### Using the frontend

```typescript
import { api } from '@/lib/api';

const parseNote = async (note: string, roster?: string[]) => {
  const response = await api.post('/notes/parse', {
    note,
    employee_roster: roster
  });
  return response.data;
};

// Usage
const result = await parseNote(
  "Sarah needs coverage for her night shift on Monday",
  ["Sarah Kim", "Alice Chen", "Bob Martinez"]
);

console.log(result.events);
```

## Error Handling

The endpoint returns appropriate HTTP status codes:

- `200 OK`: Successfully parsed the note
- `422 Unprocessable Entity`: Invalid request body
- `500 Internal Server Error`:
  - Note parser module not available
  - Missing GEMINI_API_KEY or MODEL_NAME
  - Gemini API error
  - Other parsing errors

Error responses include details in the `detail` field:

```json
{
  "detail": "Note parser configuration error: GEMINI_API_KEY environment variable is not set or is empty."
}
```

## Features

### Fuzzy Employee Name Matching

If you provide an `employee_roster`, the parser will attempt to match misspelled or partial names:

```json
{
  "note": "Alic Chen is sick",
  "employee_roster": ["Alice Chen", "Bob Martinez"]
}
```

Result:
```json
{
  "events": [{
    "employee": "Alice Chen",
    "notes": "Alic Chen matched to Alice Chen via fuzzy matching"
  }]
}
```

### Conflict Detection

The parser detects contradictory instructions in the same note:

```json
{
  "note": "Alice is off Monday. Actually, Alice is working Monday."
}
```

Both events will be returned with `confidence: "low"` and conflict notes.

### Multi-language Support

The parser can understand notes in multiple languages (though responses are always in English):

```json
{
  "note": "Milan est malade demain"
}
```

Result:
```json
{
  "events": [{
    "type": "sick_leave",
    "employee": "Milan",
    "notes": "Milan is sick tomorrow (translated)"
  }]
}
```

## Testing

Run the note parser tests:

```bash
cd packages/note_parser
uv run pytest test_note_parser.py -v
```

## Integration with Scheduling

The parsed events can be used to:

1. Create absence events for the scheduler
2. Generate coverage requests
3. Update availability windows
4. Track shift swap requests
5. Build a history of scheduling changes

Example integration:

```python
# Parse manager note
parsed = await parse_manager_note({
    "note": "Alice sick tomorrow night shift"
})

# Convert to absence event
for event in parsed["events"]:
    if event["type"] in ["sick_leave", "time_off"]:
        absence_event = AbsenceEventWindow(
            employee_id=get_employee_id(event["employee"]),
            start_date=event["affected_dates"][0],
            end_date=event["affected_dates"][-1],
            reason="sick" if event["type"] == "sick_leave" else "vacation"
        )
        # Use in scheduler
```
