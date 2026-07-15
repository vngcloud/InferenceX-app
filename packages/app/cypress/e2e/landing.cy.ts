describe('Landing page — MLOps Team Dashboard', () => {
  before(() => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('inferencex-star-modal-dismissed', String(Date.now()));
        win.localStorage.setItem('inferencex-dsv4-modal-dismissed', String(Date.now()));
        win.localStorage.setItem('inferencex-dsv4-banner-dismissed-v2', String(Date.now()));
      },
    });
    cy.contains('h1', 'MLOps Team Dashboard').should('be.visible');
  });

  it('shows Pipelines as the first workflow card, linking to /live-check', () => {
    cy.get('main section > div')
      .first()
      .within(() => {
        cy.contains('a', 'Pipelines').should('be.visible');
        cy.contains('a', 'Pipelines').should('have.attr', 'href', '/live-check');
      });
  });

  it('lists all six workflow cards in order', () => {
    const expected = [
      'Pipelines',
      'Inference',
      'Recipe Compare',
      'Historical Trends',
      'TCO Calculator',
      'GPU Specs',
    ];
    cy.get('main section a span.text-lg').then(($labels) => {
      const labels = [...$labels].map((el) => el.textContent);
      expect(labels).to.deep.equal(expected);
    });
  });

  it('navigates to Live Check when the Pipelines card is clicked', () => {
    cy.contains('a', 'Pipelines').click();
    cy.location('pathname').should('eq', '/live-check');
  });
});
