import type { Meta, StoryObj } from "@storybook/nextjs";
import {
  SeasonBannerList,
  SeasonBannerPrimary,
  SeasonBannerChips,
  type SeasonBannerData,
} from "./SeasonBanner";

/* ─── Mock data ──────────────────────────────────────────── */

const now = new Date();
const d = (offsetDays: number) => new Date(now.getTime() + offsetDays * 86400000).toISOString();

const openSeason: SeasonBannerData = {
  id: "s1",
  title: "Season 1 — Genesis",
  description: "The very first season: propose wild ideas and shape the future.",
  status: "ACTIVE",
  submissionStart: d(-5),
  buildStart: d(20),
  buildDeadline: d(40),
  _count: { proposals: 12 },
};

const buildSeason: SeasonBannerData = {
  id: "s2",
  title: "Season 2 — Forge",
  description: "Agents are building. Sit back and watch.",
  status: "ACTIVE",
  submissionStart: d(-30),
  buildStart: d(-9),
  buildDeadline: d(5),
  _count: { proposals: 8 },
};

const noDescSeason: SeasonBannerData = {
  id: "s3",
  title: "Mini Sprint",
  description: null,
  status: "ACTIVE",
  submissionStart: d(-3),
  buildStart: d(10),
  buildDeadline: d(20),
  _count: { proposals: 3 },
};

const urgentSeason: SeasonBannerData = {
  id: "s4",
  title: "Flash Round",
  description: "48-hour sprint — submit and vote fast!",
  status: "ACTIVE",
  submissionStart: d(-1),
  buildStart: d(1),
  buildDeadline: d(4),
  _count: { proposals: 5 },
};

/* ═══════════════════════════════════════════════════════════ */
/* Variant A: Stacked List                                    */
/* ═══════════════════════════════════════════════════════════ */

const listMeta: Meta<typeof SeasonBannerList> = {
  title: "Seasons/Banner — List",
  component: SeasonBannerList,
  parameters: { layout: "fullscreen" },
};
export default listMeta;

export const ListSingleOpen: StoryObj<typeof SeasonBannerList> = {
  args: { seasons: [openSeason] },
  name: "Single — Open phase",
};

export const ListSingleBuild: StoryObj<typeof SeasonBannerList> = {
  args: { seasons: [buildSeason] },
  name: "Single — Build phase",
};

export const ListTwoSeasons: StoryObj<typeof SeasonBannerList> = {
  args: { seasons: [openSeason, buildSeason] },
  name: "Two seasons (Open + Build)",
};

export const ListNoDescription: StoryObj<typeof SeasonBannerList> = {
  args: { seasons: [noDescSeason] },
  name: "No description",
};

export const ListEmpty: StoryObj<typeof SeasonBannerList> = {
  args: { seasons: [] },
  name: "Empty (renders nothing)",
};

/* ═══════════════════════════════════════════════════════════ */
/* Variant B: Primary + "+N more"                             */
/* ═══════════════════════════════════════════════════════════ */

export const PrimarySingle: StoryObj<typeof SeasonBannerPrimary> = {
  render: () => <SeasonBannerPrimary seasons={[openSeason]} />,
  name: "Primary — single",
};

export const PrimaryTwoSeasons: StoryObj<typeof SeasonBannerPrimary> = {
  render: () => <SeasonBannerPrimary seasons={[buildSeason, openSeason]} />,
  name: "Primary — 2 (shows Open first)",
};

/* ═══════════════════════════════════════════════════════════ */
/* Variant C: Horizontal Chips                                */
/* ═══════════════════════════════════════════════════════════ */

export const ChipsSingle: StoryObj<typeof SeasonBannerChips> = {
  render: () => <SeasonBannerChips seasons={[openSeason]} />,
  name: "Chips — single",
};

export const ChipsTwoSeasons: StoryObj<typeof SeasonBannerChips> = {
  render: () => <SeasonBannerChips seasons={[openSeason, buildSeason]} />,
  name: "Chips — 2 seasons",
};

export const ChipsNoDescription: StoryObj<typeof SeasonBannerChips> = {
  render: () => <SeasonBannerChips seasons={[noDescSeason]} />,
  name: "Chips — no description",
};

export const ChipsUrgentDeadline: StoryObj<typeof SeasonBannerChips> = {
  render: () => <SeasonBannerChips seasons={[urgentSeason, buildSeason]} />,
  name: "Chips — urgent deadline (tomorrow)",
};

export const ChipsThreeSeasons: StoryObj<typeof SeasonBannerChips> = {
  render: () => <SeasonBannerChips seasons={[openSeason, urgentSeason, buildSeason]} />,
  name: "Chips — 3 seasons",
};
