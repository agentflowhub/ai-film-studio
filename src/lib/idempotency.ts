// Holder på den samme idempotency-nøgle, indtil en handling er lykkedes.
// Et nyt klik efter en netværksfejl eller et fejlet forsøg genbruger derfor
// nøglen — så serveren genoptager samme opgave i stedet for at starte en ny.

export class IdempotencyKey {
  private current: string | null = null;

  constructor(private readonly prefix: string) {}

  get(): string {
    if (!this.current) this.current = `${this.prefix}-${crypto.randomUUID()}`;
    return this.current;
  }

  // Kaldes, når handlingen er lykkedes, eller når input er ændret, så næste
  // forsøg er en NY handling.
  reset(): void {
    this.current = null;
  }
}
