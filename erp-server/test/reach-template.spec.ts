import { normalizeTemplateInput, renderTemplate } from '../src/reach/reach-template';

describe('normalizeTemplateInput', () => {
  it('maps the pasted COLD/FOLLOWUP/FINALPUSH shape to the stored keys', () => {
    const out = normalizeTemplateInput({
      COLD: { subject: 'c', body: 'cb' },
      FOLLOWUP: { subject: 'f', body: 'fb' },
      FINALPUSH: { subject: 'p', body: 'pb' },
    });
    expect(out).toEqual({
      cold_outreach: { subject: 'c', body: 'cb' },
      follow_up: { subject: 'f', body: 'fb' },
      final_push: { subject: 'p', body: 'pb' },
    });
  });

  it('also accepts the stored-key spelling', () => {
    const out = normalizeTemplateInput({
      cold_outreach: { subject: 'c', body: 'cb' },
      follow_up: { subject: 'f', body: 'fb' },
      final_push: { subject: 'p', body: 'pb' },
    });
    expect(out.cold_outreach.subject).toBe('c');
  });

  it('throws when a round or its subject/body is missing', () => {
    expect(() => normalizeTemplateInput({ COLD: { subject: 'c', body: 'cb' } })).toThrow();
    expect(() => normalizeTemplateInput({ COLD: { subject: 'c' }, FOLLOWUP: {}, FINALPUSH: {} })).toThrow();
    expect(() => normalizeTemplateInput('nope')).toThrow();
  });
});

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
