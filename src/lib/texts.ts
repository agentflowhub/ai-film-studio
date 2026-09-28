// Alle brugertekster samlet ét sted (klar til i18n senere).

export const texts = {
  appName: 'AI Film Studio',

  common: {
    cancel: 'Fortryd',
    hide: 'Skjul',
  },
  tagline: 'Fra idé til storyboard — du godkender hvert trin.',

  auth: {
    title: 'Log ind',
    email: 'Din e-mail',
    send: 'Send login-link',
    sent: 'Tjek din indbakke — vi har sendt dig et login-link.',
    logout: 'Log ud',
  },

  org: {
    title: 'Opret dit studie',
    name: 'Navn på virksomhed eller studie',
    create: 'Opret',
  },

  projects: {
    title: 'Dine film',
    empty: 'Du har ingen film endnu.',
    new: 'Ny film',
    newTitle: 'Arbejdstitel',
    newIdea: 'Idéen i én eller to sætninger',
    create: 'Opret film',
    back: '← Alle film',
  },

  stages: {
    briefing: 'Brief',
    storyboarding: 'Storyboard',
    storyboard_ready: 'Storyboard godkendt',
  } as Record<string, string>,

  interview: {
    title: 'Fortæl om filmen',
    intro: 'Svarene bliver til et Film Brief, som du godkender, før storyboardet laves.',
    idea: 'Hvad handler filmen om?',
    message: 'Hvad er budskabet?',
    audience: 'Hvem er målgruppen?',
    feeling: 'Hvad skal seeren føle eller forstå?',
    duration: 'Længde i sekunder',
    style: 'Stil',
    styleNotes: 'Noter om stil (valgfrit)',
    submit: 'Lav brief',
    working: 'Instruktøren skriver briefet …',
  },

  styles: {
    mockumentary: 'Mockumentary',
    dokumentar: 'Dokumentar',
    reklame: 'Reklame',
    komedie: 'Komedie',
    drama: 'Drama',
    animation: 'Animation',
    musikvideo: 'Musikvideo',
    andet: 'Andet',
  } as Record<string, string>,

  brief: {
    title: 'Film Brief',
    version: (v: number) => `Version ${v}`,
    logline: 'Logline',
    message: 'Budskab',
    audience: 'Målgruppe',
    feeling: 'Følelse',
    duration: 'Længde',
    tone: 'Tone',
    visual: 'Visuel retning',
    characters: 'Karakterer',
    keyMoments: 'Nøgleøjeblikke',
    openQuestions: 'Instruktøren har valgt for dig her — ret gerne',
    approve: 'Godkend brief',
    reject: 'Afvis og ret svarene',
    rejectComment: 'Hvad skal være anderledes? (valgfrit)',
    approved: 'Briefet er godkendt. Nu kan storyboardet laves.',
    show: 'Vis brief',
  },

  storyboard: {
    title: 'Storyboard',
    generate: 'Lav storyboard',
    working: 'Instruktøren tegner storyboardet …',
    total: (s: number) => `Samlet ${formatSeconds(s)}`,
    scene: (n: number) => `Scene ${n}`,
    shot: 'Shot',
    camera: 'Kamera',
    action: 'Handling',
    dialogue: 'Replik',
    location: 'Location',
    characters: 'Karakterer',
    props: 'Props',
    approve: 'Godkend storyboard',
    reject: 'Afvis og lav nyt',
    approved: 'Storyboardet er godkendt. Næste trin — karakterer og referencebilleder — kommer i bid 2.',
  },

  shotTypes: {
    extreme_wide: 'Ekstrem total',
    wide: 'Total',
    medium: 'Halvtotal',
    close_up: 'Nær',
    extreme_close_up: 'Ultranær',
    over_the_shoulder: 'Over skulderen',
    pov: 'Point of view',
    insert: 'Insert',
  } as Record<string, string>,

  errors: {
    network: 'Ingen forbindelse. Tjek dit netværk, og prøv igen.',
    invalidInput: 'Nogle af felterne er ikke udfyldt korrekt. Tjek dem, og prøv igen.',
    unauthorized: 'Du er blevet logget ud. Log ind igen.',
    notFound: 'Filmen findes ikke, eller du har ikke adgang til den.',
    inProgress: 'Instruktøren arbejder allerede på det. Vent et øjeblik, og opdatér siden.',
    retryLimit: 'Det er fejlet tre gange i træk. Ret svarene, og prøv igen.',
    wrongStage: 'Filmen er gået videre til næste trin. Opdatér siden.',
    alreadyPending: 'Der ligger allerede et udkast, der venter på din godkendelse.',
    briefNotApproved: 'Briefet skal godkendes, før storyboardet kan laves.',
    alreadyDecided: 'Der er allerede truffet en beslutning. Opdatér siden.',
    storyboardOffTarget: 'Storyboardet ramte ikke filmens længde. Prøv igen.',
    refusal: 'Instruktøren kunne ikke arbejde med den idé. Omformulér den, og prøv igen.',
    generationRetry: 'Instruktøren gik i stå undervejs. Prøv igen.',
    generationPermanent: 'Det kunne ikke lade sig gøre lige nu. Kontakt support, hvis det bliver ved.',
    server: 'Noget gik galt hos os. Prøv igen om lidt.',
    unknown: 'Noget gik galt. Prøv igen.',
  },
};

export function formatSeconds(total: number): string {
  const whole = Math.round(total * 2) / 2;
  if (whole < 60) return `${String(whole).replace('.', ',')} sek.`;
  const min = Math.floor(whole / 60);
  const sec = whole - min * 60;
  return sec === 0 ? `${min} min.` : `${min} min. ${String(sec).replace('.', ',')} sek.`;
}
