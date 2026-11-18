import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';
import { cn } from '../util/cn';

export interface Idea {
  id: string;
  title: string;
  reason?: string;
}

export interface IdeaCardProps {
  idea: Idea;
  featured?: boolean;
  selected?: boolean;
  onSelect?: (idea: Idea) => void;
  onEdit?: (idea: Idea) => void;
  onRemove?: (idea: Idea) => void;
}

export function IdeaCard({
  idea,
  featured = false,
  selected = false,
  onSelect,
  onEdit,
  onRemove,
}: IdeaCardProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-4',
        featured ? 'border-spark bg-spark-soft' : 'border-line bg-surface-0',
        selected && 'ring-2 ring-brand',
      )}
    >
      <h3 className="text-heading text-ink">{idea.title}</h3>
      {idea.reason !== undefined && <p className="text-body-sm text-ink-muted">{idea.reason}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {onSelect !== undefined && (
          <Button
            variant={selected ? 'primary' : 'secondary'}
            aria-pressed={selected}
            icon={selected ? 'check' : undefined}
            onClick={() => {
              onSelect(idea);
            }}
          >
            {idea.title}
          </Button>
        )}
        {onEdit !== undefined && (
          <Button
            variant="ghost"
            icon="pencil"
            aria-label={`${t('common.edit')}: ${idea.title}`}
            onClick={() => {
              onEdit(idea);
            }}
          />
        )}
        {onRemove !== undefined && (
          <Button
            variant="ghost"
            icon="x"
            aria-label={`${t('common.remove')}: ${idea.title}`}
            onClick={() => {
              onRemove(idea);
            }}
          />
        )}
      </div>
    </article>
  );
}
