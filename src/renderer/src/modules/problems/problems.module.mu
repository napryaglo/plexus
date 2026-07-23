// problems.module.mu — the Problems dock module.
//
// Registers the ProblemsService and contributes a StatusBar-region ShellControl
// that renders it via the keyed @ProblemsDock template (problems.resources.mu).
// DataContext = ProblemsService makes the cell always-visible and document-
// independent: the shell resolves the root service as the template's data context
// (see toolbar-service.SyncStatusItems), independent of the active document.

import ProblemsService from "./problems-service.js"

module ProblemsModule [ Name = "Problems" ] {
    .services: {
        ProblemsService
    }

    .ShellControls: {
        ShellControlDefinition
            [ Template    = @ProblemsDock,
              DataContext = ProblemsService,
              Region      = StatusBar ]
    }
}
