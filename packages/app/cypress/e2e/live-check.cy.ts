describe('Live Check', () => {
  before(() => {
    cy.window().then((win) => {
      win.localStorage.setItem('inferencex-star-modal-dismissed', String(Date.now()));
    });
    cy.visit('/live-check');
    cy.get('[data-testid="live-check-stack-list"]').should('exist');
  });

  it('shows the Live Check heading', () => {
    cy.contains('h1', 'Live Check').should('be.visible');
  });

  it('renders one card per stack from the fixture', () => {
    cy.contains('sglang-mooncake-store').should('be.visible');
    cy.contains('sglang-pd-disaggregation').should('be.visible');
    cy.contains('sglang-vanilla').should('be.visible');
  });

  it('shows the GPU model badge on stacks that report one, and omits it where absent', () => {
    cy.contains('sglang-vanilla')
      .closest('[data-slot="card"]')
      .within(() => {
        cy.contains('NVIDIA GeForce RTX 5090').should('be.visible');
      });

    cy.contains('sglang-mooncake-store')
      .closest('[data-slot="card"]')
      .within(() => {
        cy.contains('NVIDIA GeForce RTX 5090').should('not.exist');
      });
  });

  it('flags a stack missing throughput data', () => {
    cy.contains('sglang-mooncake-store')
      .closest('[data-slot="card"]')
      .within(() => {
        cy.contains('No Throughput Sweep data yet for this stack.').should('be.visible');
      });
  });
});

describe('Live Check — Content & Interactions', () => {
  before(() => {
    cy.window().then((win) => {
      win.localStorage.setItem('inferencex-star-modal-dismissed', String(Date.now()));
    });
    cy.visit('/live-check');
    cy.get('[data-testid="live-check-stack-list"]').should('be.visible');
  });

  it('expanding the metadata check shows an OK badge and framework/precision details', () => {
    cy.get('[data-testid="live-check-item-sglang-vanilla-metadata"]').within(() => {
      cy.contains('OK').should('be.visible');
      cy.get('button[data-slot="accordion-trigger"]').click();
      cy.contains('sglang').should('be.visible');
      cy.contains('fp8', { matchCase: false }).should('be.visible');
    });
  });

  it('expanding the tool-calling check shows a Failing badge and the assistant response', () => {
    cy.get('[data-testid="live-check-item-sglang-vanilla-tool-calling"]').within(() => {
      cy.contains('Failing').should('be.visible');
      cy.get('button[data-slot="accordion-trigger"]').click();
      cy.contains('did not invoke the tool').should('be.visible');
    });
  });

  it('expanding the throughput check renders the concurrency sweep table', () => {
    cy.get('[data-testid="live-check-item-sglang-pd-disaggregation-throughput"]').within(() => {
      cy.get('button[data-slot="accordion-trigger"]').click();
      cy.get('table').within(() => {
        cy.contains('th', 'Concurrency').should('be.visible');
        cy.get('tbody tr').should('have.length', 3);
        cy.contains('td', '1').should('be.visible');
        cy.contains('td', '16').should('be.visible');
      });
    });
  });

  it('shows an "unconfirmed" redeploy note for a throughput run whose post-sweep check failed', () => {
    cy.get('[data-testid="live-check-item-sglang-vanilla-throughput"]').within(() => {
      cy.get('button[data-slot="accordion-trigger"]').click();
      cy.contains('unconfirmed').should('be.visible');
    });
  });

  it('the run link points at the correct GitHub Actions run', () => {
    cy.get('[data-testid="live-check-item-sglang-pd-disaggregation-throughput"]')
      .find('a')
      .should(
        'have.attr',
        'href',
        'https://github.com/vngcloud/InferenceX/actions/runs/29220857835',
      );
  });
});
