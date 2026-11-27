"""
Configuración de logs seguros.
No registrar tokens, contraseñas ni datos personales sensibles.
"""
import logging
import sys
from app.core.config import get_settings


def setup_logging() -> None:
    """Configura el logger raíz de la aplicación."""
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # Reducir verbosidad de librerías externas
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.is_development else logging.WARNING
    )
