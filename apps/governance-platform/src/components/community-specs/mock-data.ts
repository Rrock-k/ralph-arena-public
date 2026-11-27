export interface SpecProposalData {
  id: string;
  title: string;
  description: string;  // for voters — why this feature matters
  instructions: string; // for the agent — what to build
  round: number;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
  createdAt: string;
  creator: { name: string; image?: string };
  netVotes: number;
  upvotes: number;
  downvotes: number;
  userVote: 1 | -1 | 0; // current user's vote
}

export interface SpecData {
  id: string;
  title: string | null;
  content: string;
  addedBy: "initial" | "admin" | "community";
  createdAt: string;
  creator?: { name: string };
}

export interface SpecWindowState {
  status: "closed" | "open" | "scheduled";
  currentRound: number;
  maxRounds: number;
  opensAt?: string;
  closesAt?: string;
  maxAcceptedSpecs: number;
  specVoteThreshold: number;
}

// --- Mock spec proposals ---

export const mockProposals: SpecProposalData[] = [
  {
    id: "sp-1",
    title: "Add dark mode toggle",
    description:
      "Сейчас только светлая тема — вечером пользоваться невозможно. Нужен переключатель темы в хедере.",
    instructions:
      "Add a dark/light mode toggle in the header. Persist preference in localStorage. Respect `prefers-color-scheme` on first visit. Use CSS variables for theming.",
    round: 1,
    status: "PROPOSED",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Alice" },
    netVotes: 7,
    upvotes: 9,
    downvotes: 2,
    userVote: 1,
  },
  {
    id: "sp-2",
    title: "Keyboard shortcuts for navigation",
    description:
      "Power users хотят навигироваться без мыши. Клавиатурные шорткаты сильно ускорят работу.",
    instructions:
      "Implement `j`/`k` for navigating between items, `Enter` to open, `Esc` to go back. Show a `?` overlay listing all available shortcuts.",
    round: 1,
    status: "PROPOSED",
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Bob" },
    netVotes: 4,
    upvotes: 6,
    downvotes: 2,
    userVote: 0,
  },
  {
    id: "sp-3",
    title: "Export data as CSV",
    description:
      "Нужна возможность выгружать данные для анализа в Excel или Google Sheets.",
    instructions:
      "Add an export button that downloads the current view as a CSV file. Should work for tables and list views. Use UTF-8 BOM for Excel compatibility.",
    round: 1,
    status: "PROPOSED",
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Charlie" },
    netVotes: 2,
    upvotes: 3,
    downvotes: 1,
    userVote: -1,
  },
  {
    id: "sp-4",
    title: "Real-time collaboration cursors",
    description:
      "Было бы круто видеть, где находятся другие пользователи — как в Figma.",
    instructions:
      "Show other users' cursors in the editor in real-time, similar to Figma/Google Docs. Use WebSockets for communication.",
    round: 1,
    status: "PROPOSED",
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Diana" },
    netVotes: -1,
    upvotes: 2,
    downvotes: 3,
    userVote: 0,
  },
  {
    id: "sp-5",
    title: "Add i18n support",
    description:
      "Много русскоязычных пользователей, нужна локализация.",
    instructions:
      "Internationalise the UI with at least English and Russian translations using `next-intl`.",
    round: 1,
    status: "REJECTED",
    createdAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Eve" },
    netVotes: 0,
    upvotes: 1,
    downvotes: 1,
    userVote: 0,
  },
];

export const mockAcceptedProposals: SpecProposalData[] = [
  { ...mockProposals[0], status: "ACCEPTED" },
  { ...mockProposals[1], status: "ACCEPTED" },
];

// --- Mock existing specs (for the full section) ---

export const mockSpecs: SpecData[] = [
  {
    id: "s-1",
    title: "Initial Specification",
    content:
      "Build a task management app with drag-and-drop Kanban board, user authentication, and real-time updates.",
    addedBy: "initial",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "s-2",
    title: "Add dark mode toggle",
    content:
      "Add a dark/light mode toggle in the header. Should persist preference in localStorage and respect `prefers-color-scheme` on first visit.",
    addedBy: "community",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    creator: { name: "Alice" },
  },
  {
    id: "s-3",
    title: "Performance requirements",
    content: "Lighthouse score must be ≥90 for Performance and Accessibility. Bundle size under 200KB gzipped.",
    addedBy: "admin",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// --- Vote budget ---

export interface VoteBudget {
  used: number;
  max: number;  // maxVotesPerDay from config
}

export const budgetFresh: VoteBudget = { used: 0, max: 5 };
export const budgetPartial: VoteBudget = { used: 3, max: 5 };
export const budgetExhausted: VoteBudget = { used: 5, max: 5 };

// --- Spec window states ---

export const windowOpen: SpecWindowState = {
  status: "open",
  currentRound: 1,
  maxRounds: 3,
  closesAt: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(), // 14h from now
  maxAcceptedSpecs: 3,
  specVoteThreshold: 2,
};

export const windowScheduled: SpecWindowState = {
  status: "scheduled",
  currentRound: 0,
  maxRounds: 3,
  opensAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2h from now
  maxAcceptedSpecs: 3,
  specVoteThreshold: 2,
};

export const windowClosed: SpecWindowState = {
  status: "closed",
  currentRound: 1,
  maxRounds: 3,
  maxAcceptedSpecs: 3,
  specVoteThreshold: 2,
};

export const windowClosedFinal: SpecWindowState = {
  status: "closed",
  currentRound: 3,
  maxRounds: 3,
  maxAcceptedSpecs: 3,
  specVoteThreshold: 2,
};
