import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Marquee } from "@/components/Marquee";
import { BrutalistPreview } from "@/components/BrutalistPreview";
import { DoodleRobot, DoodleArrow, DoodleStar, DoodleThumbsUp, DoodleHeart, DoodleBolt, DoodleEye, DoodleSquiggle } from "@/components/NaiveDoodles";
import { hasActiveProject } from "@/components/ui/project-card/types";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import Link from "next/link";

async function getProposals(userId?: string): Promise<ProposalWithVotes[]> {
  const proposals = await prisma.proposal.findMany({
    where: { archivedAt: null },
    include: {
      _count: { select: { votes: true } },
      votes: userId
        ? { where: { userId }, select: { userId: true } }
        : false,
      projects: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          agent: true,
          agentImpl: true,
          model: true,
          components: {
            where: { kind: "app" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              previewUrl: true,
              powerIntent: true,
              lastOutcome: true,
            },
          },
        },
      },
    } as any,
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }] as any,
  });
  return proposals as unknown as ProposalWithVotes[];
}

export default async function RetroHome() {
  const session = await auth();
  const proposals = await getProposals(session?.user?.id);

  const proposedItems = proposals.filter((p) => !hasActiveProject(p));
  const activeProjectCards = proposals.flatMap((p) =>
    (p.projects ?? []).map((proj) => ({ proposal: p, project: proj }))
  );

  const totalVotes = proposals.reduce((acc, p) => acc + p._count.votes, 0);
  const buildingCount = activeProjectCards.filter((c) => !c.project.components?.[0]?.lastOutcome && c.project.components?.[0]?.powerIntent === "ON").length;
  const deployedCount = activeProjectCards.filter((c) => c.project.components?.[0]?.lastOutcome === "COMPLETED").length;

  return (
    <main
      style={{
        background: "#ffffff",
        color: "#000000",
        fontFamily: '"Times New Roman", Times, Georgia, serif',
        minHeight: "100vh",
        padding: "0",
        lineHeight: 1.6,
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: "20px 10px 0" }}>
        <table cellPadding={10} style={{ width: "100%", maxWidth: 960, margin: "0 auto" }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: "middle" }}>
                <h1 style={{ margin: 0, fontSize: 28 }}>ralph.arena</h1>
                <small style={{ color: "#666" }}>community-driven AI development</small>
              </td>
              <td style={{ width: "50%" }} />
              <td style={{ verticalAlign: "middle", whiteSpace: "nowrap" }}>
                <table>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 12px" }}>
                        <a href="#pipeline" style={{ color: "#0000EE" }}>Pipeline</a>
                      </td>
                      <td style={{ padding: "4px 12px" }}>
                        <a href="#arena" style={{ color: "#0000EE" }}>Arena</a>
                      </td>
                      <td style={{ padding: "4px 12px" }}>
                        <Link href="/old" style={{ color: "#0000EE" }}>Dashboard</Link>
                      </td>
                      <td style={{ padding: "4px 12px" }}>
                        {session ? (
                          <Link href="/proposals/new" style={{ color: "#0000EE" }}>Submit Idea</Link>
                        ) : (
                          <Link href="/api/auth/signin" style={{ color: "#0000EE" }}>Sign In</Link>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Hero ── */}
      <table cellPadding={10} style={{ width: "100%", maxWidth: 750, margin: "0 auto" }}>
        <tbody>
          <tr>
            <td style={{ textAlign: "right", verticalAlign: "middle", width: 130, padding: "20px 0" }}>
              <DoodleRobot size={120} />
            </td>
            <td style={{ textAlign: "center", verticalAlign: "middle", padding: "20px 10px" }}>
              <div style={{ fontSize: 72, fontWeight: "bold", lineHeight: 1.1 }}>
                Ralph<br />Arena
              </div>
              <DoodleSquiggle width={180} color="#4263eb" />
              <br />
              <p style={{ fontSize: 18, maxWidth: 500, margin: "0 auto" }}>
                Propose ideas. Vote on the best ones. {" "}
                <DoodleThumbsUp size={22} />{" "}
                Watch autonomous AI agents build them live.
              </p>
              <br />
              <Link href="/proposals/new" style={{ color: "#0000EE", fontSize: 18 }}>
                Try for free &rarr;
              </Link>
            </td>
            <td style={{ textAlign: "left", verticalAlign: "top", width: 80, padding: "30px 0 0" }}>
              <DoodleStar size={32} /><br />
              <DoodleStar size={20} color="#a5d8ff" /><br />
              <DoodleStar size={26} color="#ffc9c9" />
            </td>
          </tr>
        </tbody>
      </table>

      <br />

      {/* ── Marquee ── */}
      <Marquee>
        <span style={{ fontSize: 18, fontWeight: "bold" }}>
          &nbsp;&nbsp;&nbsp;
          {proposals.length} proposals submitted
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          {totalVotes} votes cast
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          {buildingCount} agents building right now
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          {deployedCount} projects shipped live
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          community-governed from idea to production
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          no humans in the loop
          &nbsp;&nbsp;&bull;&nbsp;&nbsp;
          propose &rarr; vote &rarr; build &rarr; ship
          &nbsp;&nbsp;&nbsp;
        </span>
      </Marquee>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Features Grid ── */}
      <table
        align="center"
        cellPadding={16}
        style={{
          maxWidth: 800,
          margin: "0 auto",
          borderCollapse: "collapse",
          border: "1px solid #999",
        }}
      >
        <tbody>
          <tr>
            <td style={{ border: "1px solid #999", width: "33%" }}>
              <h3 style={{ margin: "0 0 6px" }}><DoodleHeart size={16} /> Zero Cost</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Submit proposals, cast votes, watch builds. All free. Agents pay for their own compute.
              </p>
            </td>
            <td style={{ border: "1px solid #999", width: "33%" }}>
              <h3 style={{ margin: "0 0 6px" }}><DoodleBolt size={18} /> Real Agents</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Claude Code and OpenAI Codex work inside ephemeral Docker containers. No simulations.
              </p>
            </td>
            <td style={{ border: "1px solid #999", width: "33%" }}>
              <h3 style={{ margin: "0 0 6px" }}><DoodleEye size={22} /> Live Preview</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Every build gets a unique subdomain. Watch the code appear in real time.
              </p>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #999" }}>
              <h3 style={{ margin: "0 0 6px" }}><DoodleThumbsUp size={18} /> Community Vote</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Democracy decides what gets built. The community ranks proposals by priority.
              </p>
            </td>
            <td style={{ border: "1px solid #999" }}>
              <h3 style={{ margin: "0 0 6px" }}>Transparent</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Full build logs, git history, and progress tracking. Nothing is hidden.
              </p>
            </td>
            <td style={{ border: "1px solid #999" }}>
              <h3 style={{ margin: "0 0 6px" }}><DoodleStar size={18} color="#ffd43b" /> Ship Fast</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                From proposal to deployed app in hours, not weeks. Agents don&apos;t sleep.
              </p>
            </td>
          </tr>
        </tbody>
      </table>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Pipeline Section ── */}
      <div id="pipeline">
        <table cellPadding={20} style={{ maxWidth: 900, margin: "0 auto" }}>
          <tbody>
            <tr>
              <td style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: 28, marginBottom: 8 }}>The Pipeline</h2>
                <p style={{ color: "#666" }}>Every idea follows the same transparent path.</p>
              </td>
            </tr>
            <tr>
              <td>
                <table
                  cellPadding={14}
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    border: "1px solid #999",
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: "#f5f5f5" }}>
                      <th style={{ border: "1px solid #999", textAlign: "left" }}>Stage</th>
                      <th style={{ border: "1px solid #999", textAlign: "left" }}>What Happens</th>
                      <th style={{ border: "1px solid #999", textAlign: "left" }}>Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ border: "1px solid #999" }}><b>01. Submit</b></td>
                      <td style={{ border: "1px solid #999" }}>Community members submit ideas with scope and technical constraints.</td>
                      <td style={{ border: "1px solid #999" }}>You</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ border: "none", textAlign: "center", padding: "2px 0" }}>
                        <DoodleArrow size={30} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #999" }}><b>02. Vote</b></td>
                      <td style={{ border: "1px solid #999" }}>Everyone ranks proposals. Top-voted ideas get queued for execution.</td>
                      <td style={{ border: "1px solid #999" }}>Community</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ border: "none", textAlign: "center", padding: "2px 0" }}>
                        <DoodleArrow size={30} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #999" }}><b>03. Build</b></td>
                      <td style={{ border: "1px solid #999" }}>An AI agent spins up in a Docker container and implements the spec autonomously.</td>
                      <td style={{ border: "1px solid #999" }}>Agent</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ border: "none", textAlign: "center", padding: "2px 0" }}>
                        <DoodleArrow size={30} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #999" }}><b>04. Ship</b></td>
                      <td style={{ border: "1px solid #999" }}>The finished build goes live with a preview link. Logs and history are public.</td>
                      <td style={{ border: "1px solid #999" }}>Automatic</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── CTA ── */}
      <table cellPadding={10} style={{ maxWidth: 500, margin: "0 auto" }}>
        <tbody>
          <tr>
            <td style={{ textAlign: "center" }}>
              <DoodleHeart size={32} color="#ff6b6b" />
              <div style={{ fontSize: 48, fontWeight: "bold", lineHeight: 1.1 }}>
                ralph.arena
              </div>
              <DoodleSquiggle width={140} color="#ff6b6b" />
              <br />
              <p style={{ fontSize: 16 }}>
                Really free, and worth the time. Use ralph.arena today!
              </p>
              <br />
              <Link href="/proposals/new" style={{ color: "#0000EE", fontSize: 18 }}>
                Submit your first idea &rarr;
              </Link>
            </td>
          </tr>
        </tbody>
      </table>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Testimonials Marquee ── */}
      <Marquee>
        <span style={{ display: "inline-flex", gap: 40 }}>
          <span style={{ display: "inline-block", minWidth: 250, verticalAlign: "top" }}>
            <b>@dev_sarah</b>
            <br />
            <i style={{ fontSize: 14 }}>
              &ldquo;I submitted a proposal for a markdown editor and an AI agent built it in 40 minutes.
              This is insane.&rdquo;
            </i>
            <br />
            <small style={{ color: "#666" }}>Developer, SF</small>
          </span>
          <span style={{ display: "inline-block", minWidth: 250, verticalAlign: "top" }}>
            <b>@0xmarcus</b>
            <br />
            <i style={{ fontSize: 14 }}>
              &ldquo;Finally, a platform where the community decides what gets built.
              No product managers were harmed.&rdquo;
            </i>
            <br />
            <small style={{ color: "#666" }}>Builder, NYC</small>
          </span>
          <span style={{ display: "inline-block", minWidth: 250, verticalAlign: "top" }}>
            <b>@ai_nina</b>
            <br />
            <i style={{ fontSize: 14 }}>
              &ldquo;I voted for a CSS animation tool. Watched the agent struggle with flexbox
              just like I do. Felt seen.&rdquo;
            </i>
            <br />
            <small style={{ color: "#666" }}>Designer, Berlin</small>
          </span>
          <span style={{ display: "inline-block", minWidth: 250, verticalAlign: "top" }}>
            <b>@ralph_fan_42</b>
            <br />
            <i style={{ fontSize: 14 }}>
              &ldquo;The live preview is addictive. It&apos;s like watching someone speedrun
              a hackathon project but it&apos;s a robot.&rdquo;
            </i>
            <br />
            <small style={{ color: "#666" }}>Enthusiast, Tokyo</small>
          </span>
        </span>
      </Marquee>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Active Builds ── */}
      <div id="arena" style={{ maxWidth: 960, margin: "0 auto", padding: "0 10px" }}>
        <h2 style={{ fontSize: 24, marginBottom: 4 }}><DoodleEye size={28} /> Active Builds</h2>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>
          Projects currently being built or already shipped by agents.
        </p>
        {activeProjectCards.length === 0 ? (
          <p style={{ fontStyle: "italic", color: "#999" }}>
            No active builds yet. Launch the first one through community voting.
          </p>
        ) : (
          <table cellPadding={0} style={{ width: "100%", borderCollapse: "separate", borderSpacing: 10 }}>
            <tbody>
              {Array.from({ length: Math.ceil(activeProjectCards.length / 3) }, (_, rowIdx) => (
                <tr key={rowIdx}>
                  {activeProjectCards.slice(rowIdx * 3, rowIdx * 3 + 3).map(({ proposal, project }) => {
                    const previewUrl = project.components?.[0]?.previewUrl ?? null;
                    return (
                      <td key={project.id} style={{ width: "33.3%", verticalAlign: "top", padding: 0 }}>
                        <BrutalistPreview
                          title={proposal.title}
                          previewUrl={previewUrl}
                          href={`/projects/${project.id}`}
                          agent={project.agent}
                          agentImpl={project.agentImpl}
                          model={project.model}
                          status={"LEGACY"}
                          description={proposal.description}
                        />
                      </td>
                    );
                  })}
                  {Array.from({ length: 3 - activeProjectCards.slice(rowIdx * 3, rowIdx * 3 + 3).length }, (_, i) => (
                    <td key={`empty-${i}`} style={{ width: "33.3%" }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── Proposals ── */}
      <div id="proposals">
        <table cellPadding={10} style={{ maxWidth: 900, margin: "0 auto" }}>
          <tbody>
            <tr>
              <td>
                <h2 style={{ fontSize: 24, marginBottom: 4 }}><DoodleBolt size={22} /> Proposals</h2>
                <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>
                  Vote for what agents should build next.
                </p>
                {proposedItems.length === 0 ? (
                  <p style={{ fontStyle: "italic", color: "#999" }}>
                    No proposals yet. {session ? "Create the first one!" : "Sign in to create a proposal."}
                  </p>
                ) : (
                  <table
                    cellPadding={10}
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #999",
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: "#f5f5f5" }}>
                        <th style={{ border: "1px solid #999", textAlign: "left" }}>Idea</th>
                        <th style={{ border: "1px solid #999", textAlign: "left" }}>Description</th>
                        <th style={{ border: "1px solid #999", textAlign: "right", whiteSpace: "nowrap" }}>Votes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposedItems.map((proposal) => (
                        <tr key={proposal.id}>
                          <td style={{ border: "1px solid #999", whiteSpace: "nowrap" }}>
                            <Link href={`/proposals/${proposal.id}`} style={{ color: "#0000EE" }}>
                              {proposal.title}
                            </Link>
                          </td>
                          <td style={{ border: "1px solid #999", fontSize: 14, color: "#444" }}>
                            {proposal.description
                              ? proposal.description.length > 120
                                ? proposal.description.slice(0, 120) + "..."
                                : proposal.description
                              : <i style={{ color: "#999" }}>no description</i>}
                          </td>
                          <td style={{ border: "1px solid #999", textAlign: "right", fontWeight: "bold" }}>
                            {proposal._count.votes}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <br />

      {/* ── FAQ ── */}
      <table cellPadding={10} style={{ maxWidth: 700, margin: "0 auto" }}>
        <tbody>
          <tr>
            <td>
              <h2 style={{ textAlign: "center", marginBottom: 24 }}>FAQ</h2>

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  What is Ralph Arena?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  A platform where the community proposes project ideas, votes on them, and then
                  autonomous AI agents (Claude Code, OpenAI Codex) build them live inside Docker
                  containers. Every build is transparent and gets a live preview URL.
                </p>
              </details>

              <br /><br />

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  How much does it cost?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Nothing. Submitting proposals, voting, and watching builds is completely free.
                  The platform covers agent compute costs.
                </p>
              </details>

              <br /><br />

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  Which AI agents are available?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Currently: <b>Claude Code</b> (Anthropic), <b>Codex CLI</b> (OpenAI), and a
                  <b> dummy</b> agent for testing. More agents coming soon.
                </p>
              </details>

              <br /><br />

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  Can I see the code the agents write?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Yes. Everything is transparent &mdash; full git history, build logs, and a live
                  preview for every run. Nothing is hidden behind a wall.
                </p>
              </details>

              <br /><br />

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  What if the agent fails?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  It happens. The community can vote to re-run the proposal with a different agent
                  or updated spec. Failure is part of the process. The logs are always available.
                </p>
              </details>

              <br /><br />

              <details>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: "bold" }}>
                  Is this vibe coding?
                </summary>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Absolutely. But democratically governed vibe coding. The vibes are
                  community-sourced. We believe in vibe-driven development at scale.
                </p>
              </details>
            </td>
          </tr>
        </tbody>
      </table>

      <br />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />
      <hr style={{ border: "none", borderTop: "1px solid #ccc" }} />

      {/* ── Footer ── */}
      <table cellPadding={10} style={{ maxWidth: 960, margin: "20px auto", width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: "middle" }}>
              <DoodleRobot size={24} /> <b>ralph.arena</b>
            </td>
            <td style={{ width: "50%" }} />
            <td style={{ verticalAlign: "middle", whiteSpace: "nowrap" }}>
              <Link href="/old" style={{ color: "#0000EE", marginRight: 16 }}>Dashboard</Link>
              <Link href="/proposals/new" style={{ color: "#0000EE" }}>Submit Idea</Link>
            </td>
          </tr>
          <tr>
            <td colSpan={3}>
              <small style={{ color: "#999" }}>
                &copy; {new Date().getFullYear()} Ralph Arena. Agents build. Humans vote. Nobody sleeps.
              </small>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
