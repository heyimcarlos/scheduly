import pytest
from unittest.mock import patch, MagicMock
from datetime import date
from app.services.recommendations import FatigueAwareRecommendationService

@patch('fatigue_inference.predict_fatigue')
def test_recommendation_uses_mocked_fatigue_score(mock_predict, system_config):
    """
    Validates that the service correctly incorporates a fatigue score 
    from the ML model without actually running TensorFlow.
    """
    # 1. Setup the Mock to return a specific fatigue value
    mock_predict.return_value = {"predicted_fatigue": 0.85}

    service = FatigueAwareRecommendationService(system_config=system_config)
    
    # 2. Define a minimal scenario
    employees = [{"employee_id": 1, "region": "Canada", "employee_name": "Sun"}]
    absence = {"absent_employee_id": 99, "day_offset": 0}
    
    # 3. Call the service with the 'prefer_fatigue_model' flag
    recs = service.build_recommendations(
        employees=employees,
        start_date=date(2026, 3, 28),
        num_days=1,
        absence_event=absence,
        prefer_fatigue_model=True # This triggers the _predict_model_fatigue path
    )

    # 4. Assertions
    assert recs[0].fatigue_score == 0.85
    assert recs[0].fatigue_source == "model"
    # Ensure the mock was actually called once
    mock_predict.assert_called_once()