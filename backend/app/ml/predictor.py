"""
Predictor — carga el artefacto `.joblib` versionado y realiza inferencia de regresión.
Incluye verificación de compatibilidad de dimensión de features.
"""
import logging
from decimal import Decimal
from pathlib import Path

import joblib
import numpy as np

logger = logging.getLogger(__name__)

_model_cache: dict[str, object] = {}


def load_and_predict(artifact_path: str, features: np.ndarray) -> Decimal:
    """
    Carga el modelo desde `artifact_path` (con caché en memoria)
    y retorna la predicción como Decimal (>= 0).
    """
    if artifact_path not in _model_cache:
        path = Path(artifact_path)
        if not path.exists():
            raise FileNotFoundError(f"Artefacto de modelo no encontrado: {artifact_path}")
        _model_cache[artifact_path] = joblib.load(path)
        logger.info("Modelo cargado: %s", artifact_path)

    model = _model_cache[artifact_path]
    expected_n = getattr(model, "n_features_in_", None)
    if expected_n is not None and features.shape[1] != expected_n:
        raise ValueError(
            f"Incompatibilidad de features: el modelo espera {expected_n} variables "
            f"y recibió {features.shape[1]}. Reentrena el modelo con ml_pipeline.train."
        )

    prediction = model.predict(features)[0]
    prediction = max(0.0, float(prediction))
    return Decimal(str(round(prediction, 4)))


def clear_model_cache() -> None:
    """Limpia la caché de modelos en memoria."""
    _model_cache.clear()
    logger.info("Caché de modelos limpiada.")
