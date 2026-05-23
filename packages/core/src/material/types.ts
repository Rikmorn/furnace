declare const __furnaceMaterialBrand: unique symbol;

export type Material = {
  readonly [__furnaceMaterialBrand]: true;
};
