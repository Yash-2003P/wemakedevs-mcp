import { z } from 'zod';

export const HackathonSummarySchema = z.object({
  title: z.string(),
  url: z.string().url(),
  location: z.string().nullable(),
  formats: z.array(z.string()),
  kind: z.enum(['online', 'in-person', 'hybrid', 'unknown']),
  prize: z.string().nullable(),
  dateText: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.enum(['upcoming', 'ongoing', 'past', 'unknown']),
  external: z.boolean(),
});

export const HackathonListSchema = z.object({
  count: z.number().int(),
  items: z.array(HackathonSummarySchema),
  source: z.literal('dom'),
  asOf: z.string(),
  note: z.string().nullable(),
});

export const SectionBlockSchema = z.object({
  type: z.enum(['heading', 'paragraph', 'list', 'pre']),
  text: z.string().optional(),
  level: z.number().int().optional(),
  items: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});

export const PageSectionSchema = z.object({
  id: z.string(),
  heading: z.string().nullable(),
  blocks: z.array(SectionBlockSchema),
});

export const FaqItemSchema = z.object({ question: z.string(), answer: z.string().nullable() });

export const LinkSchema = z.object({ text: z.string(), href: z.string().url() });

export const HackathonDetailSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  prizePool: z.string().nullable(),
  when: z.string().nullable(),
  where: z.string().nullable(),
  teams: z.string().nullable(),
  sections: z.array(PageSectionSchema),
  faq: z.array(FaqItemSchema),
  links: z.array(LinkSchema),
});

export const RulesSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  sections: z.array(PageSectionSchema),
  links: z.array(LinkSchema),
});

export const MeetupSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  location: z.string().nullable(),
  dateText: z.string().nullable(),
  description: z.string().nullable(),
});

export const MeetupListSchema = z.object({
  count: z.number().int(),
  items: z.array(MeetupSchema),
  asOf: z.string(),
});

export const CareerRoleSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  postedAt: z.string().nullable(),
  tags: z.array(z.string()),
  location: z.string().nullable(),
  kind: z.string().nullable(),
  compensation: z.string().nullable(),
});

export const CareerListSchema = z.object({
  count: z.number().int(),
  items: z.array(CareerRoleSchema),
  note: z.string().nullable(),
  asOf: z.string(),
});

export const ScholarshipSchema = z.object({
  program: z.string().nullable(),
  status: z.enum(['open', 'closed', 'unknown']),
  statusText: z.string().nullable(),
  covers: z.array(z.object({ name: z.string(), detail: z.string().nullable() })),
  winners: z.array(z.object({
    name: z.string(),
    event: z.string().nullable(),
    profileUrl: z.string().nullable(),
  })),
  faqs: z.array(FaqItemSchema),
});

export const RegistrationStatusSchema = z.object({
  url: z.string().url(),
  state: z.enum(['open', 'closed', 'upcoming', 'unknown']),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  registeredCount: z.number().int().nullable(),
  notes: z.string().nullable(),
  observedAt: z.string(),
  method: z.literal('tinyfish-agent'),
});

export const DeadlineItemSchema = z.object({
  kind: z.enum(['hackathon-start', 'hackathon-end']),
  title: z.string(),
  date: z.string(),
  url: z.string().url(),
});

export const DeadlinesSchema = z.object({
  withinDays: z.number().int(),
  asOf: z.string(),
  items: z.array(DeadlineItemSchema),
  note: z.string().nullable(),
});

export const HealthCheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  soft: z.boolean(),
  ms: z.number().int(),
  detail: z.string(),
});

export const HealthReportSchema = z.object({
  ok: z.boolean(),
  mode: z.enum(['live', 'offline', 'stub']),
  checkedAt: z.string(),
  results: z.array(HealthCheckResultSchema),
});

export const BlogPostSummarySchema = z.object({
  title: z.string(),
  url: z.string().url(),
  pubDate: z.string().nullable(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  categories: z.array(z.string()),
});

export const BlogListSchema = z.object({
  count: z.number().int(),
  items: z.array(BlogPostSummarySchema),
  source: z.literal('rss'),
  asOf: z.string(),
});

export const BlogPostSchema = BlogPostSummarySchema.extend({
  paragraphs: z.array(z.string()),
  links: z.array(z.object({ text: z.string(), href: z.string().url() })),
});

export const ScheduleMilestoneSchema = z.object({
  whenText: z.string(),
  date: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  state: z.enum(['explicit-date', 'marker']),
});

export const ScheduleSchema = z.object({
  url: z.string().url(),
  items: z.array(ScheduleMilestoneSchema),
});

export const ResourcesSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  groups: z.array(
    z.object({
      name: z.string(),
      links: z.array(
        z.object({
          label: z.string(),
          url: z.string().url(),
          note: z.string().nullable(),
        }),
      ),
    }),
  ),
  commands: z.array(z.string()),
});

export const UpdateItemSchema = z.object({
  kind: z.enum(['blog', 'hackathon-start', 'hackathon-end']),
  title: z.string(),
  date: z.string(),
  url: z.string().url(),
  summary: z.string().nullable(),
});

export const UpdatesSchema = z.object({
  withinDays: z.number().int(),
  asOf: z.string(),
  items: z.array(UpdateItemSchema),
  note: z.string().nullable(),
});

export const HackathonChangesSchema = z.object({
  asOf: z.string(),
  baselineCapturedAt: z.string().nullable(),
  baselineCreated: z.boolean(),
  baselineUpdated: z.boolean(),
  compared: z.number().int(),
  added: z.array(z.object({ title: z.string(), url: z.string().url() })),
  removed: z.array(z.object({ title: z.string(), url: z.string().url() })),
  changed: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      fields: z.array(
        z.object({
          field: z.string(),
          before: z.string().nullable(),
          after: z.string().nullable(),
        }),
      ),
    }),
  ),
  unchanged: z.number().int(),
  note: z.string().nullable(),
});
