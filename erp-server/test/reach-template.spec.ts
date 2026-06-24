import { renderTemplate } from '../src/reach/reach-template';

const VARS = {
  company: 'Granozita GmbH',
  type: 'provider',
  industryFocus: 'IT',
  tenderFocus: 'Cloud Infrastructure',
};

describe('renderTemplate', () => {
  it('substitutes every token, with {{Company}} and {{Company Name}} as aliases', () => {
    const out = renderTemplate(
      '{{Company}} / {{Company Name}} — {{Type}} in {{IndustryFocus}} for {{TenderFocus}}',
      VARS,
    );
    expect(out).toBe('Granozita GmbH / Granozita GmbH — provider in IT for Cloud Infrastructure');
  });

  it('tolerates inner whitespace in tokens', () => {
    expect(renderTemplate('{{ Company }} · {{  Type  }}', VARS)).toBe('Granozita GmbH · provider');
  });

  it('leaves an unrecognized token untouched (typos stay visible)', () => {
    expect(renderTemplate('Hi {{Whatever}}', VARS)).toBe('Hi {{Whatever}}');
  });
});
