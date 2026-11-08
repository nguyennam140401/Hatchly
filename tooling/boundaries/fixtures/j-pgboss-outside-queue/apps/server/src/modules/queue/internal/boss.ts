// Bộ nối trong modules/queue/internal – được phép nhập pg-boss, cron-parser.
import { PgBoss } from 'pg-boss';
import { CronExpressionParser } from 'cron-parser';

export const boss = [PgBoss, CronExpressionParser];
