const fetch = require("./fetch");

if (!process.env.GITHUB_TOKEN) {
  console.error("🔴 No GITHUB_TOKEN found. pass `GITHUB_TOKEN` as env");
  process.exitCode = 1;
  return;
}
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!process.env.GITHUB_REPOSITORY) {
  console.error(
    "🔴 No GITHUB_REPOSITORY found. pass `GITHUB_REPOSITORY` as env"
  );
  process.exitCode = 1;
  return;
}

if (!process.env.INPUT_REPO) {
  console.warn("💬  No `repo` name given. fall-ing back to this repo");
}

const [owner, repo] = (
  process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY
).split("/");

if (!owner || !repo) {
  console.error("☠️  Either owner or repo name is empty. exiting...");
  process.exitCode = 1;
  return;
}

if (!process.env.INPUT_KEEP_LATEST) {
  console.error("✋🏼  No `keep_latest` given. exiting...");
  process.exitCode = 1;
  return;
}

const keepLatest = Number(process.env.INPUT_KEEP_LATEST);

if (Number.isNaN(keepLatest) || keepLatest < 0) {
  console.error("🤮  Invalid `keep_latest` given. exiting...");
  process.exitCode = 1;
  return;
}

if (keepLatest === 0) {
  console.error("🌶  Given `keep_latest` is 0, this will wipe out all releases");
}

const dryRun = process.env.INPUT_DRY_RUN !== "false";

if (dryRun) {
  console.log("🔖  Dry run");
}

const shouldDeleteTags = process.env.INPUT_DELETE_TAGS === "true";

if (shouldDeleteTags) {
  console.log("🔖  Corresponding git tags also will be deleted");
}

const preReleaseOnly = process.env.INPUT_PRE_RELEASE_ONLY !== "false";
if (shouldDeleteTags) {
  console.log("🔖  Only pre-releases will be deleted");
}

const olderThanDays = Number(process.env.INPUT_OLDER_THAN);

let deletePattern = process.env.INPUT_DELETE_TAG_PATTERN || "";
if (deletePattern) {
  console.log(`releases matching regex '${deletePattern}' will be targeted`);
}
const commonOpts = {
  host: "api.github.com",
  port: 443,
  protocol: "https:",
  auth: `user:${GITHUB_TOKEN}`,
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "node.js",
  },
};

function filterReleases(data){
  const today = new Date();
  let matchedReleases = data.filter(
    ({ id, draft, prerelease, tag_name, published_at }) => {
        if (tag_name.match(deletePattern) == null)
            return false;

        if (preReleaseOnly && !prerelease){
            console.log(`- Skipping ${tag_name} (prerelease=${prerelease}) with id ${id}`);
            return false;
        }

        const daysOld = Math.ceil((today-Date.parse(published_at)) / (1000 * 3600 * 24));
        if (daysOld <= olderThanDays){
            console.log(`- Skipping ${tag_name} with id ${id}, published ${published_at} (${daysOld} days ago)`);
            return false;
        }
        return !draft;
    }
  );
  return matchedReleases;
}

async function deleteOlderReleases(keepLatest) {
  let releaseIdsAndTags = [];
  try {
    let data = await fetch({
      ...commonOpts,
      path: `/repos/${owner}/${repo}/releases?per_page=100`,
      method: "GET",
    });
    data = data || [];
    // filter for delete_pattern
    const activeMatchedReleases = filterReleases(data);

    if (activeMatchedReleases.length === 0) {
      console.log(`😕  no active releases found. exiting...`);
      return;
    }

    const matchingLoggingAddition = deletePattern.length > 0 ? " matching" : "";

    console.log(
      `💬  found total of ${activeMatchedReleases.length}${matchingLoggingAddition} active release(s)`
    );

    releaseIdsAndTags = activeMatchedReleases
      .sort((a,b)=> Date.parse(b.published_at) - Date.parse(a.published_at))
      .map(({ id, tag_name: tagName, prerelease, published_at: publishedAt }) =>
        ({ id, tagName, prerelease, publishedAt }));

    const keepers = releaseIdsAndTags.slice(0,keepLatest);
    console.log(`Keeping ${keepers.length} latest release(s):`);
    for (let i = 0; i < keepers.length; i++) {
      const { id: releaseId, tagName, publishedAt } = keepers[i];
      console.log(`- Keeping ${tagName} with id ${releaseId} published ${publishedAt}`);
    }

    releaseIdsAndTags = releaseIdsAndTags.slice(keepLatest);

  } catch (error) {
    console.error(`🌶  failed to get list of releases <- ${error.message}`);
    console.error(`exiting...`);
    process.exitCode = 1;
    return;
  }

  if (releaseIdsAndTags.length === 0) {
    console.error(`😕  No older releases found. exiting...`);
    return;
  }
  console.log(`🍻  Found ${releaseIdsAndTags.length} older release(s) to delete:`);

  let hasError = false;
  for (let i = 0; i < releaseIdsAndTags.length; i++) {
    const { id: releaseId, tagName } = releaseIdsAndTags[i];

    if (dryRun) {
      console.log(`- (DRY-RUN) Would delete ${tagName} with id ${releaseId}`);
    } else {
      try {
        console.log(`- Deleting ${tagName} with id ${releaseId}`);

        const _ = await fetch({
          ...commonOpts,
          path: `/repos/${owner}/${repo}/releases/${releaseId}`,
          method: "DELETE",
        });

        if (shouldDeleteTags) {
          try {
            const _ = await fetch({
              ...commonOpts,
              path: `/repos/${owner}/${repo}/git/refs/tags/${tagName}`,
              method: "DELETE",
            });
          } catch (error) {
            console.error(
              `🌶  Failed to delete tag "${tagName}"  <- ${error.message}`
            );
            hasError = true;
            break;
          }
        }
      } catch (error) {
        console.error(
          `🌶  Failed to delete release with id "${releaseId}"  <- ${error.message}`
        );
        hasError = true;
        break;
      }
    }
  }

  if (hasError) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `👍🏼  ${releaseIdsAndTags.length} older release(s) deleted successfully!`
  );
}

async function run() {
  await deleteOlderReleases(keepLatest);
}

run();
