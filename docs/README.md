# Documentation & Visual Assets (`docs/`)

This directory centralizes all architecture specifications, vector diagrams, and formal security audits for the Verifyyy platform.

---

## Directory Organization

```
docs/
├── diagrams/                                  # High-resolution SVG system architecture diagrams
│   ├── architecture_diagram.svg               # High-level end-to-end architecture diagram
│   ├── diagram_2_sequence.svg                 # End-to-end verification sequence flow
│   ├── diagram_3_pipeline_builder.svg         # Dynamic pipeline builder & runner flow
│   ├── diagram_4_face_match_decision.svg      # Multi-tier face match & fallback decision logic
│   ├── diagram_5_liveness_antispoof.svg       # Multi-modal liveness & anti-spoofing architecture
│   └── diagram_6_supabase_er.svg              # Supabase entity-relationship & cloud sync schema
│
└── reports/                                   # Formal security and compliance reports
    ├── Verifyyy_Security_Architecture_and_Remediation_Report.docx # Word document security audit report
    └── generate_security_report_docx.py       # Automated generator script for the audit report
```

---

## Diagram References

All diagrams are linked directly into the root [README.md](file:///e:/Zudoc/EKYC%20for%20DEMO/mvp/README.md) with corresponding Mermaid source definitions for easy maintenance and rendering across all devices.
