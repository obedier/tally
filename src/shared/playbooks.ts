import type { CategoryId, ResearchMode } from "./report";

/**
 * Versioned category playbooks, per docs/PRODUCT.md and docs/LEARNING.md.
 * Every report records the playbook id + version that produced it. Question
 * templates are ordered by leverage: Quick mode takes the top slice.
 */

export type PlaybookQuestion = {
  id: string;
  template: string;
  whyItMatters: string;
  /** Higher runs earlier and survives Quick-mode trimming. */
  leverage: number;
};

export type Playbook = {
  id: CategoryId;
  version: string;
  label: string;
  /** Criteria the comparison stage weighs for this category. */
  criteria: string[];
  questions: PlaybookQuestion[];
};

export const PLAYBOOKS: Record<CategoryId, Playbook> = {
  "consumer-electronics": {
    id: "consumer-electronics",
    version: "1.0.0",
    label: "Consumer electronics",
    criteria: [
      "specs that actually matter for the stated use case",
      "current generation and successor risk",
      "ecosystem and compatibility",
      "software support lifespan",
      "reliability and repairability record",
      "battery and total ownership cost",
      "deal history and typical street price",
      "warranty and retailer experience",
    ],
    questions: [
      {
        id: "ce-fit",
        template: "Which current models best fit this use case and budget?",
        whyItMatters: "Anchors the shortlist on the user's actual need, not on flagship marketing.",
        leverage: 100,
      },
      {
        id: "ce-specs",
        template: "Which specs genuinely matter here, and how do the candidates compare on them?",
        whyItMatters: "Spec sheets bury the two or three numbers that change the experience.",
        leverage: 90,
      },
      {
        id: "ce-reviews",
        template: "What do editorial tests and long-term owner reviews agree and disagree on?",
        whyItMatters: "Disagreement between testers and owners is where hidden flaws live.",
        leverage: 85,
      },
      {
        id: "ce-generation",
        template: "Is a successor imminent, and does the current generation hold its value?",
        whyItMatters: "Buying weeks before a refresh is the most common electronics regret.",
        leverage: 70,
      },
      {
        id: "ce-price",
        template: "What are the real online and local price ranges right now?",
        whyItMatters: "Street price and list price often differ by enough to change the verdict.",
        leverage: 65,
      },
      {
        id: "ce-ownership",
        template: "What are the ownership costs: battery, accessories, subscriptions, repairs?",
        whyItMatters: "The sticker is not the price; ownership costs compound.",
        leverage: 50,
      },
      {
        id: "ce-support",
        template: "How long will software updates and warranty support realistically last?",
        whyItMatters: "Support lifespan decides how long the purchase stays good.",
        leverage: 40,
      },
    ],
  },
  "home-goods": {
    id: "home-goods",
    version: "1.0.0",
    label: "Home goods",
    criteria: [
      "materials and safety",
      "size and fit for the space",
      "durability and care requirements",
      "comfort, noise, and energy where applicable",
      "real-home review patterns",
      "assembly, delivery, and return friction",
      "aesthetic constraints",
      "long-term value",
    ],
    questions: [
      {
        id: "hg-fit",
        template: "Which options best fit this home, space, and budget?",
        whyItMatters: "Size, layout, and household details eliminate half the market immediately.",
        leverage: 100,
      },
      {
        id: "hg-materials",
        template: "What are the materials, and are there safety or care concerns?",
        whyItMatters: "Materials decide safety, cleaning burden, and how the product ages.",
        leverage: 90,
      },
      {
        id: "hg-reviews",
        template: "What do long-term owners in real homes consistently praise or complain about?",
        whyItMatters: "Showroom impressions fade; month-six reviews tell the truth.",
        leverage: 85,
      },
      {
        id: "hg-durability",
        template: "How durable is it, and what does maintenance actually involve?",
        whyItMatters: "Durability and upkeep decide the real cost per year of ownership.",
        leverage: 70,
      },
      {
        id: "hg-price",
        template: "What are the real online and local price ranges right now?",
        whyItMatters: "Home goods discount cycles are steep; timing changes the answer.",
        leverage: 65,
      },
      {
        id: "hg-logistics",
        template: "How painful are delivery, assembly, and returns for the candidates?",
        whyItMatters: "A great product with a brutal return policy is a risky pick.",
        leverage: 50,
      },
      {
        id: "hg-aesthetic",
        template: "Which options satisfy the stated aesthetic or visual constraints?",
        whyItMatters: "A functional pick the user dislikes looking at gets returned.",
        leverage: 40,
      },
    ],
  },
  other: {
    id: "other",
    version: "1.0.0",
    label: "General",
    criteria: [
      "fit for stated need and budget",
      "quality and reliability evidence",
      "real owner experience",
      "price and availability",
      "return and warranty terms",
    ],
    questions: [
      {
        id: "gen-fit",
        template: "Which options best fit this need and budget?",
        whyItMatters: "The shortlist has to start from the user's constraints.",
        leverage: 100,
      },
      {
        id: "gen-reviews",
        template: "What do expert tests and owner reviews agree and disagree on?",
        whyItMatters: "Agreement across independent source classes is the trust signal.",
        leverage: 85,
      },
      {
        id: "gen-price",
        template: "What are the real online and local price ranges right now?",
        whyItMatters: "Price context turns a good product into a good decision.",
        leverage: 65,
      },
      {
        id: "gen-risks",
        template: "What are the known failure modes, and how are warranty claims handled?",
        whyItMatters: "Downside risk is half of any buying decision.",
        leverage: 50,
      },
    ],
  },
};

/** Quick mode trims to the highest-leverage questions per docs/ENGINE.md. */
export const MODE_QUESTION_LIMITS: Record<ResearchMode, number> = {
  quick: 3,
  full: 7,
  deep: 10,
};

export function questionsForMode(playbook: Playbook, mode: ResearchMode): PlaybookQuestion[] {
  const sorted = [...playbook.questions].sort((a, b) => b.leverage - a.leverage);
  return sorted.slice(0, MODE_QUESTION_LIMITS[mode]);
}
