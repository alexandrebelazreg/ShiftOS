"""Versioned business defaults shared with the TypeScript builder/validator."""
import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[3] /
                    'features/core/planning-v3/multi-sector-policy.json').read_text())
if POLICY['version'] != 1:
    raise ValueError('Unsupported multi-sector policy version')
