// Regression test for issue #326: chart PNG/CSV downloads should use the
// currently-selected model name, not whichever model was active at first render.
//
// The bug: `useChartExport`'s `useCallback` omitted `exportFileName` from its
// dependency array, so the callback closed over the stale model name from the
// initial render.

function captureDownloads() {
  cy.window().then((win) => {
    (win as unknown as { __capturedFilenames: string[] }).__capturedFilenames = [];
    const original = win.HTMLAnchorElement.prototype.click;
    cy.stub(win.HTMLAnchorElement.prototype, 'click').callsFake(function (this: HTMLAnchorElement) {
      if (this.download) {
        (win as unknown as { __capturedFilenames: string[] }).__capturedFilenames.push(
          this.download,
        );
        return;
      }
      return original.call(this);
    });
  });
}

function switchModel(label: string) {
  cy.get('[data-testid="model-selector"]').click();
  cy.get('[role="option"]').contains(label).click();
  cy.get('body').type('{esc}');
  cy.contains('No data available').should('not.exist');
  cy.get('[data-testid="scatter-graph"] svg circle', { timeout: 20_000 }).should(
    'have.length.greaterThan',
    0,
  );
}

describe('Chart download filename reflects currently selected model (#326)', () => {
  beforeEach(() => {
    cy.window().then((win) => {
      win.localStorage.setItem('inferencex-star-modal-dismissed', String(Date.now()));
    });
    cy.visit('/inference');
    cy.get('[data-testid="inference-chart-display"]').should('exist');
    cy.contains('No data available').should('not.exist');
    cy.get('[data-testid="scatter-graph"] svg circle', { timeout: 20_000 }).should(
      'have.length.greaterThan',
      0,
    );
  });

  it('CSV filename updates after switching model (covers same useCallback closure)', () => {
    captureDownloads();

    // Default model is DeepSeek-R1-0528 — confirm by exporting first.
    cy.get('[data-testid="export-button"]').first().click();
    cy.get('[data-testid="export-csv-button"]').click();

    cy.window()
      .its('__capturedFilenames')
      .should((names: string[]) => {
        expect(names.at(-1)).to.match(/DeepSeek-R1-0528/);
      });

    // Switch to DeepSeek V4 Pro (dsv4) and export again.
    switchModel('DeepSeek V4 Pro');
    cy.get('[data-testid="export-button"]').first().click();
    cy.get('[data-testid="export-csv-button"]').click();

    cy.window()
      .its('__capturedFilenames')
      .should((names: string[]) => {
        const last = names.at(-1);
        expect(last, `last filename: ${last}`).to.match(/DeepSeek-V4-Pro/);
        expect(last, `last filename: ${last}`).not.to.match(/DeepSeek-R1/);
      });
  });

  it('PNG filename updates after switching model (cached useCallback regression)', () => {
    captureDownloads();

    // Export PNG once on the default model so the export callback is cached
    // by useCallback. Without the fix, this cached callback closes over the
    // initial exportFileName and re-uses it on the next export — even after
    // the model changes.
    cy.get('[data-testid="export-button"]').first().click();
    cy.get('[data-testid="export-png-button"]').click();
    cy.get('[data-testid="export-button"]', { timeout: 30_000 })
      .first()
      .should('not.contain.text', 'Exporting');

    cy.window()
      .its('__capturedFilenames')
      .should((names: string[]) => {
        expect(names.at(-1), `first PNG filename: ${names.at(-1)}`).to.match(/DeepSeek-R1-0528/);
      });

    switchModel('DeepSeek V4 Pro');

    cy.get('[data-testid="export-button"]').first().click();
    cy.get('[data-testid="export-png-button"]').click();
    cy.get('[data-testid="export-button"]', { timeout: 30_000 })
      .first()
      .should('not.contain.text', 'Exporting');

    cy.window()
      .its('__capturedFilenames')
      .should((names: string[]) => {
        expect(names.length).to.be.greaterThan(1);
        const last = names.at(-1);
        expect(last, `second PNG filename: ${last}`).to.match(/DeepSeek-V4-Pro/);
        expect(last, `second PNG filename: ${last}`).not.to.match(/DeepSeek-R1/);
      });
  });
});
