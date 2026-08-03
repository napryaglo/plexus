// library-class-data.ts — the DataType every generated library-presentation
// template declares. The mural compiler requires a DataTemplate to name a
// `DataType`, and DataTemplate.Apply passes the data straight to the factory
// without checking it — so for the library's key-based resolution this type is
// inert metadata, present only to satisfy the compiler and to document intent:
// the templates target a library class instance, supplied at runtime as a plain
// `{ Display }` object by the panel/canvas. Mirrors the meta-model's
// MetaModelEntity role, without pulling meta-model internals into the runtime.
export class LibraryClassData {}
