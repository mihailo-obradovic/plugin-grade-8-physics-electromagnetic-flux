import type { PluginLocale } from './types';

type ExerciseContent = {
  checkpoints: readonly [string, string, string];
};

export const exerciseContent: Record<PluginLocale, ExerciseContent> = {
  en: {
    checkpoints: [
      'Induce a current by pushing the magnet into the coil.',
      'Induce the opposite current by pulling the magnet out.',
      'Hold the magnet still inside the coil — current returns to zero.'
    ]
  },
  'sr-latn': {
    checkpoints: [
      'Indukujte struju gurajući magnet u zavojnicu.',
      'Indukujte struju suprotnog smjera izvlačeći magnet iz zavojnice.',
      'Držite magnet mirno unutar zavojnice — struja se vraća na nulu.'
    ]
  },
  'sr-cyrl': {
    checkpoints: [
      'Индукујте струју гурајући магнет у завојницу.',
      'Индукујте струју супротног смјера извлачећи магнет из завојнице.',
      'Држите магнет мирно унутар завојнице — струја се враћа на нулу.'
    ]
  }
};
