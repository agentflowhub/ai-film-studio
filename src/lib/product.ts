// Produktets navn og definition — ét sted. Navnet er en placeholder, indtil
// brandet er besluttet; et brand-skift er en ændring i product.config.json,
// aldrig i den funktionelle kerne.
//
// Produktnavnet må aldrig afhænge af en karakter, film eller demo.
// Testkarakterer hører til i Golden Test Case (fixtures/golden-test-case).

import product from '../../product.config.json';

export const PRODUCT_NAME: string = product.name;
export const PRODUCT_DEFINITION: string = product.definition;
