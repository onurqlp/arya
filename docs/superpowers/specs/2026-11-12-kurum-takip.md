# Kurum Takip scope

User approved the ARYA CRM/course read-only AR-GE and now explicitly requests implementing and publishing it as a tab on the existing site. Production publication of this addition is authorized; existing messaging behavior and the source systems are not to be changed.

The current crm.aydadil.com and kurs.aydadil.com applications require login; their repository/API/credentials are unavailable through connected sources. Do not connect to the old lehrer application or imply its records represent the current panels. Ship real connector/query infrastructure and an honest disconnected state, not invented numbers. Actual private-data connectivity remains blocked until a compatible, authorized read API is supplied.

First version: admin-only same-site tab; six structured queries (overdue payments, attendance exceptions, checked missing homework, group summary, student summary, overdue plus absence). Versioned normalized source contract with canonical shared student/group IDs, explicit completeness, date coverage and integer minor currency units. No automatic name joins. Each result identifies source retrieval time and partial/unavailable state. No student-facing access, automated messages, AI calls or source writes.

Use existing auth guards. All new functionality must work without invoking the existing message DB, schema creation, cleanup or Meta health. No source credentials appear in client code, logs or API output. A missing source is not an empty source. First launch has no configured source connections; the UI must explain the remaining requirement in plain Turkish.
