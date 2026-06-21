const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  })
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper: safely build an ObjectId, returns null if invalid
const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

async function run() {
  try {
    await client.connect();

    const db = client.db("wisdom-vault");
    const usersCollection = db.collection("user");
    const lessonsCollection = db.collection("lessons");
    const favoritesCollection = db.collection("favorites");
    const commentsCollection = db.collection("comments");
    const reportsCollection = db.collection("lessonsReports");

    // =========================================================
    // LESSONS
    // =========================================================

    // Create lesson
    app.post("/api/lessons", async (req, res) => {
      try {
        const lessonData = req.body;

        if (!lessonData.title || !lessonData.description) {
          return res.status(400).send({
            success: false,
            message: "Title and description are required",
          });
        }

        const result = await lessonsCollection.insertOne({
          ...lessonData,
          visibility: lessonData.visibility || "Public",
          accessLevel: lessonData.accessLevel || "Free",
          likes: [],
          likesCount: 0,
          favoritesCount: 0,
          views: Math.floor(Math.random() * 10000),
          isFeatured: false,
          isReviewed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        res.status(201).send({
          success: true,
          message: "Lesson added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Add lesson error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to add lesson",
        });
      }
    });

    // Get all public lessons — search + filter + sort + pagination
    app.get("/api/lessons", async (req, res) => {
      try {
        const { category, emotionalTone, search, sort, page, limit } =
          req.query;

        const query = { visibility: "Public" };
        if (category) query.category = category;
        if (emotionalTone) query.emotionalTone = emotionalTone;
        if (search) query.title = { $regex: search, $options: "i" };

        const pageNumber = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 9, 1);
        const skip = (pageNumber - 1) * pageSize;

        let sortQuery = { createdAt: -1 }; // default newest
        if (sort === "oldest") sortQuery = { createdAt: 1 };
        else if (sort === "mostSaved") sortQuery = { favoritesCount: -1 };

        const totalCount = await lessonsCollection.countDocuments(query);
        const lessons = await lessonsCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(pageSize)
          .toArray();

        res.status(200).send({
          success: true,
          message: "Lessons fetched successfully",
          data: lessons,
          totalCount,
          page: pageNumber,
          totalPages: Math.ceil(totalCount / pageSize) || 1,
        });
      } catch (error) {
        console.error("Fetch lessons error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch lessons",
        });
      }
    });

    // Get all lessons created by a specific user (for My Lessons dashboard page)
    // IMPORTANT: must be declared BEFORE "/api/lessons/:id" to avoid route collision
    app.get("/api/lessons/user/:creatorId", async (req, res) => {
      try {
        const { creatorId } = req.params;

        const lessons = await lessonsCollection
          .find({ creatorId })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send({
          success: true,
          message: "User lessons fetched successfully",
          data: lessons,
        });
      } catch (error) {
        console.error("Fetch user lessons error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user lessons",
        });
      }
    });

    // Get single lesson details — creator info, comments, similar lessons
    app.get("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const lessonObjectId = toObjectId(id);

        if (!lessonObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid lesson id",
          });
        }

        const lesson = await lessonsCollection.findOne({
          _id: lessonObjectId,
        });

        if (!lesson) {
          return res.status(404).send({
            success: false,
            message: "Lesson not found",
          });
        }

        // Creator info
        let creator = null;
        let creatorLessonsCount = 0;
        const creatorObjectId = toObjectId(lesson.creatorId);

        if (creatorObjectId) {
          creator = await usersCollection.findOne(
            { _id: creatorObjectId },
            { projection: { name: 1, photoURL: 1, email: 1 } }
          );
          creatorLessonsCount = await lessonsCollection.countDocuments({
            creatorId: lesson.creatorId,
          });
        }

        // Comments for this lesson
        const comments = await commentsCollection
          .find({ lessonId: id })
          .sort({ createdAt: -1 })
          .toArray();

        // Similar lessons — same category or emotional tone, public, excluding self
        const similarLessons = await lessonsCollection
          .find({
            _id: { $ne: lessonObjectId },
            visibility: "Public",
            $or: [
              { category: lesson.category },
              { emotionalTone: lesson.emotionalTone },
            ],
          })
          .limit(6)
          .toArray();

        res.status(200).send({
          success: true,
          message: "Lesson fetched successfully",
          data: {
            ...lesson,
            creator,
            creatorLessonsCount,
            comments,
            similarLessons,
          },
        });
      } catch (error) {
        console.error("Fetch lesson details error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch lesson details",
        });
      }
    });

    // Toggle like
    app.patch("/api/lessons/:id/like", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;
        const lessonObjectId = toObjectId(id);

        if (!userId) {
          return res.status(400).send({
            success: false,
            message: "userId is required",
          });
        }

        if (!lessonObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid lesson id",
          });
        }

        const lesson = await lessonsCollection.findOne({
          _id: lessonObjectId,
        });

        if (!lesson) {
          return res.status(404).send({
            success: false,
            message: "Lesson not found",
          });
        }

        const alreadyLiked = (lesson.likes || []).includes(userId);

        const update = alreadyLiked
          ? { $pull: { likes: userId }, $inc: { likesCount: -1 } }
          : { $addToSet: { likes: userId }, $inc: { likesCount: 1 } };

        const updatedLesson = await lessonsCollection.findOneAndUpdate(
          { _id: lessonObjectId },
          update,
          { returnDocument: "after" }
        );

        res.status(200).send({
          success: true,
          message: alreadyLiked ? "Lesson unliked" : "Lesson liked",
          liked: !alreadyLiked,
          likes: updatedLesson.likes,
          likesCount: Math.max(updatedLesson.likesCount || 0, 0),
        });
      } catch (error) {
        console.error("Like toggle error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update like",
        });
      }
    });

    // Update lesson — owner only (full edit form, or quick toggle of visibility/accessLevel)
    app.patch("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, ...updateData } = req.body;
        const lessonObjectId = toObjectId(id);

        if (!lessonObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid lesson id",
          });
        }

        const lesson = await lessonsCollection.findOne({
          _id: lessonObjectId,
        });

        if (!lesson) {
          return res.status(404).send({
            success: false,
            message: "Lesson not found",
          });
        }

        // Only the lesson owner (or an admin, checked via userId + role lookup) can update
        let isAdmin = false;
        if (userId) {
          const requester = await usersCollection.findOne({ _id: toObjectId(userId) });
          isAdmin = requester?.role === "admin";
        }

        if (lesson.creatorId !== userId && !isAdmin) {
          return res.status(403).send({
            success: false,
            message: "You are not authorized to update this lesson",
          });
        }

        // Never allow these fields to be overwritten through this route
        delete updateData._id;
        delete updateData.creatorId;
        delete updateData.likes;
        delete updateData.likesCount;
        delete updateData.favoritesCount;
        delete updateData.createdAt;

        const updatedLesson = await lessonsCollection.findOneAndUpdate(
          { _id: lessonObjectId },
          { $set: { ...updateData, updatedAt: new Date() } },
          { returnDocument: "after" }
        );

        res.status(200).send({
          success: true,
          message: "Lesson updated successfully",
          data: updatedLesson,
        });
      } catch (error) {
        console.error("Update lesson error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update lesson",
        });
      }
    });

    // Delete lesson — owner or admin only
    app.delete("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.query;
        const lessonObjectId = toObjectId(id);

        if (!lessonObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid lesson id",
          });
        }

        const lesson = await lessonsCollection.findOne({
          _id: lessonObjectId,
        });

        if (!lesson) {
          return res.status(404).send({
            success: false,
            message: "Lesson not found",
          });
        }

        let isAdmin = false;
        if (userId) {
          const requester = await usersCollection.findOne({ _id: toObjectId(userId) });
          isAdmin = requester?.role === "admin";
        }

        if (lesson.creatorId !== userId && !isAdmin) {
          return res.status(403).send({
            success: false,
            message: "You are not authorized to delete this lesson",
          });
        }

        await lessonsCollection.deleteOne({ _id: lessonObjectId });

        // Clean up related data so nothing orphaned is left behind
        await favoritesCollection.deleteMany({ lessonId: id });
        await commentsCollection.deleteMany({ lessonId: id });
        await reportsCollection.deleteMany({ lessonId: id });

        res.status(200).send({
          success: true,
          message: "Lesson deleted successfully",
        });
      } catch (error) {
        console.error("Delete lesson error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete lesson",
        });
      }
    });

    // =========================================================
    // FAVORITES
    // =========================================================

    // Toggle favorite (save / unsave) — keeps lessons.favoritesCount in sync
    app.post("/api/favorites/toggle", async (req, res) => {
      try {
        const { lessonId, userId } = req.body;
        const lessonObjectId = toObjectId(lessonId);

        if (!lessonId || !userId) {
          return res.status(400).send({
            success: false,
            message: "lessonId and userId are required",
          });
        }

        if (!lessonObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid lesson id",
          });
        }

        const existing = await favoritesCollection.findOne({
          lessonId,
          userId,
        });

        if (existing) {
          await favoritesCollection.deleteOne({ _id: existing._id });

          const updatedLesson = await lessonsCollection.findOneAndUpdate(
            { _id: lessonObjectId },
            { $inc: { favoritesCount: -1 } },
            { returnDocument: "after" }
          );

          return res.status(200).send({
            success: true,
            saved: false,
            message: "Removed from favorites",
            favoritesCount: Math.max(updatedLesson?.favoritesCount || 0, 0),
          });
        }

        await favoritesCollection.insertOne({
          lessonId,
          userId,
          savedAt: new Date(),
        });

        const updatedLesson = await lessonsCollection.findOneAndUpdate(
          { _id: lessonObjectId },
          { $inc: { favoritesCount: 1 } },
          { returnDocument: "after" }
        );

        res.status(200).send({
          success: true,
          saved: true,
          message: "Added to favorites",
          favoritesCount: Math.max(updatedLesson?.favoritesCount || 1, 1),
        });
      } catch (error) {
        console.error("Favorite toggle error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update favorites",
        });
      }
    });

    // Check if a lesson is favorited by a user
    app.get("/api/favorites/check", async (req, res) => {
      try {
        const { lessonId, userId } = req.query;

        if (!lessonId || !userId) {
          return res.status(400).send({
            success: false,
            message: "lessonId and userId are required",
          });
        }

        const existing = await favoritesCollection.findOne({
          lessonId,
          userId,
        });

        res.status(200).send({
          success: true,
          saved: !!existing,
        });
      } catch (error) {
        console.error("Favorite check error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to check favorite status",
        });
      }
    });

    // Get all favorites of a logged-in user (for My Favorites dashboard page)
    app.get("/api/favorites/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        const favorites = await favoritesCollection
          .find({ userId })
          .sort({ savedAt: -1 })
          .toArray();

        const lessonIds = favorites
          .map((f) => toObjectId(f.lessonId))
          .filter(Boolean);

        const lessons = lessonIds.length
          ? await lessonsCollection
              .find({ _id: { $in: lessonIds } })
              .toArray()
          : [];

        // Attach creator name to each lesson for display in the table
        const creatorIds = [
          ...new Set(lessons.map((l) => l.creatorId).filter(Boolean)),
        ];
        const creatorObjectIds = creatorIds
          .map((cid) => toObjectId(cid))
          .filter(Boolean);

        const creators = creatorObjectIds.length
          ? await usersCollection
              .find(
                { _id: { $in: creatorObjectIds } },
                { projection: { name: 1 } }
              )
              .toArray()
          : [];

        const creatorMap = creators.reduce((map, c) => {
          map[c._id.toString()] = c.name;
          return map;
        }, {});

        const lessonsWithCreator = lessons.map((lesson) => ({
          ...lesson,
          creatorName: creatorMap[lesson.creatorId] || "Unknown",
        }));

        // Preserve "most recently favorited" order from the favorites collection
        const lessonOrder = favorites.map((f) => f.lessonId);
        lessonsWithCreator.sort(
          (a, b) =>
            lessonOrder.indexOf(a._id.toString()) -
            lessonOrder.indexOf(b._id.toString())
        );

        res.status(200).send({
          success: true,
          data: lessonsWithCreator,
        });
      } catch (error) {
        console.error("Fetch favorites error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch favorites",
        });
      }
    });


    // =========================================================
    // COMMENTS
    // =========================================================

    app.post("/api/comments", async (req, res) => {
      try {
        const { lessonId, userId, userName, userPhoto, text } = req.body;

        if (!lessonId || !userId || !text || !text.trim()) {
          return res.status(400).send({
            success: false,
            message: "lessonId, userId and text are required",
          });
        }

        const comment = {
          lessonId,
          userId,
          userName: userName || "Anonymous",
          userPhoto: userPhoto || "",
          text: text.trim(),
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(comment);

        res.status(201).send({
          success: true,
          message: "Comment posted successfully",
          comment: { ...comment, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Add comment error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to post comment",
        });
      }
    });

    // =========================================================
    // REPORTS
    // =========================================================

    app.post("/api/lessons/:id/report", async (req, res) => {
      try {
        const { id } = req.params;
        const { reporterUserId, reportedUserEmail, reason } = req.body;

        if (!reporterUserId || !reason) {
          return res.status(400).send({
            success: false,
            message: "reporterUserId and reason are required",
          });
        }

        await reportsCollection.insertOne({
          lessonId: id,
          reporterUserId,
          reportedUserEmail: reportedUserEmail || null,
          reason,
          timestamp: new Date(),
        });

        res.status(201).send({
          success: true,
          message: "Lesson reported successfully",
        });
      } catch (error) {
        console.error("Report lesson error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to report lesson",
        });
      }
    });

    // =========================================================
    // USERS
    // =========================================================

    app.get("/api/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.status(200).send({
          success: true,
          data: user,
        });
      } catch (error) {
        console.error("Fetch user error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch user",
        });
      }
    });

    // Update own profile — only name and image (photo) can be changed here.
    // Email, role, and isPremium are protected and can never be modified through this route.
    app.patch("/api/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        // Accept either "image" or "photoURL" from the client, but always store as "image"
        // to match the actual field name used in the user document.
        const { name, image, photoURL } = req.body;
        const incomingImage = image ?? photoURL;
        const userObjectId = toObjectId(id);

        if (!userObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid user id",
          });
        }

        const updateData = {};
        if (typeof name === "string" && name.trim()) {
          updateData.name = name.trim();
        }
        if (typeof incomingImage === "string" && incomingImage.trim()) {
          updateData.image = incomingImage.trim();
        }

        if (Object.keys(updateData).length === 0) {
          return res.status(400).send({
            success: false,
            message: "Nothing to update",
          });
        }

        const updatedUser = await usersCollection.findOneAndUpdate(
          { _id: userObjectId },
          { $set: { ...updateData, updatedAt: new Date() } },
          { returnDocument: "after" }
        );

        if (!updatedUser) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.status(200).send({
          success: true,
          message: "Profile updated successfully",
          data: updatedUser,
        });
      } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update profile",
        });
      }
    });

    // ---------------- ADMIN: MANAGE USERS ----------------

    // Helper: verify the requester is an admin. Used by every admin-only route below.
    const requireAdmin = async (requesterId) => {
      const requesterObjectId = toObjectId(requesterId);
      if (!requesterObjectId) return false;
      const requester = await usersCollection.findOne({
        _id: requesterObjectId,
      });
      return requester?.role === "admin";
    };

    // List all users with their total lessons created — admin only
    app.get("/api/users", async (req, res) => {
      try {
        const { requesterId } = req.query;

        const isAdmin = await requireAdmin(requesterId);
        if (!isAdmin) {
          return res.status(403).send({
            success: false,
            message: "Only admins can view the user list",
          });
        }

        const users = await usersCollection
          .find({})
          .project({ name: 1, email: 1, role: 1, image: 1, isPremium: 1 })
          .sort({ name: 1 })
          .toArray();

        // Attach lesson count per user in one aggregation instead of N queries
        const lessonCounts = await lessonsCollection
          .aggregate([
            { $group: { _id: "$creatorId", count: { $sum: 1 } } },
          ])
          .toArray();

        const countMap = lessonCounts.reduce((map, item) => {
          map[item._id] = item.count;
          return map;
        }, {});

        const usersWithCounts = users.map((u) => ({
          ...u,
          totalLessonsCreated: countMap[u._id.toString()] || 0,
        }));

        res.status(200).send({
          success: true,
          data: usersWithCounts,
        });
      } catch (error) {
        console.error("Fetch users error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch users",
        });
      }
    });

    // Promote/demote a user's role — admin only, and an admin cannot change their own role
    // (prevents accidentally locking yourself out of the admin panel)
    app.patch("/api/users/:id/role", async (req, res) => {
      try {
        const { id } = req.params;
        const { role, requesterId } = req.body;
        const userObjectId = toObjectId(id);

        if (!userObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid user id",
          });
        }

        if (!["user", "admin"].includes(role)) {
          return res.status(400).send({
            success: false,
            message: "Role must be either 'user' or 'admin'",
          });
        }

        const isAdmin = await requireAdmin(requesterId);
        if (!isAdmin) {
          return res.status(403).send({
            success: false,
            message: "Only admins can change user roles",
          });
        }

        if (requesterId === id) {
          return res.status(400).send({
            success: false,
            message: "You cannot change your own role",
          });
        }

        const updatedUser = await usersCollection.findOneAndUpdate(
          { _id: userObjectId },
          { $set: { role, updatedAt: new Date() } },
          { returnDocument: "after" }
        );

        if (!updatedUser) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.status(200).send({
          success: true,
          message: `User role updated to ${role}`,
          data: updatedUser,
        });
      } catch (error) {
        console.error("Update user role error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update user role",
        });
      }
    });

    // Delete a user account — admin only, and an admin cannot delete their own account
    app.delete("/api/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { requesterId } = req.query;
        const userObjectId = toObjectId(id);

        if (!userObjectId) {
          return res.status(400).send({
            success: false,
            message: "Invalid user id",
          });
        }

        const isAdmin = await requireAdmin(requesterId);
        if (!isAdmin) {
          return res.status(403).send({
            success: false,
            message: "Only admins can delete user accounts",
          });
        }

        if (requesterId === id) {
          return res.status(400).send({
            success: false,
            message: "You cannot delete your own account",
          });
        }

        const result = await usersCollection.deleteOne({
          _id: userObjectId,
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.status(200).send({
          success: true,
          message: "User account deleted successfully",
        });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete user",
        });
      }
    });

    // ---------------- ADMIN: MANAGE LESSONS ----------------

    // List all lessons (any visibility, any creator) with creator name, report
    // count, and overall stats — for the admin Manage Lessons page
    app.get("/api/admin/lessons", async (req, res) => {
      try {
        const { requesterId } = req.query;

        const isAdmin = await requireAdmin(requesterId);
        if (!isAdmin) {
          return res.status(403).send({
            success: false,
            message: "Only admins can manage lessons",
          });
        }

        const lessons = await lessonsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        // Attach creator name to each lesson
        const creatorIds = [
          ...new Set(lessons.map((l) => l.creatorId).filter(Boolean)),
        ];
        const creatorObjectIds = creatorIds
          .map((cid) => toObjectId(cid))
          .filter(Boolean);

        const creators = creatorObjectIds.length
          ? await usersCollection
              .find(
                { _id: { $in: creatorObjectIds } },
                { projection: { name: 1, email: 1 } }
              )
              .toArray()
          : [];

        const creatorMap = creators.reduce((map, c) => {
          map[c._id.toString()] = c;
          return map;
        }, {});

        // Attach report count per lesson
        const reportCounts = await reportsCollection
          .aggregate([{ $group: { _id: "$lessonId", count: { $sum: 1 } } }])
          .toArray();

        const reportMap = reportCounts.reduce((map, item) => {
          map[item._id] = item.count;
          return map;
        }, {});

        const lessonsWithExtras = lessons.map((lesson) => ({
          ...lesson,
          creatorName: creatorMap[lesson.creatorId]?.name || "Unknown",
          creatorEmail: creatorMap[lesson.creatorId]?.email || "",
          reportCount: reportMap[lesson._id.toString()] || 0,
        }));

        // Overall stats for the page header
        const publicCount = lessons.filter(
          (l) => l.visibility === "Public"
        ).length;
        const privateCount = lessons.filter(
          (l) => l.visibility === "Private"
        ).length;
        const flaggedCount = lessons.filter(
          (l) => (reportMap[l._id.toString()] || 0) > 0
        ).length;

        res.status(200).send({
          success: true,
          data: {
            lessons: lessonsWithExtras,
            stats: {
              total: lessons.length,
              publicCount,
              privateCount,
              flaggedCount,
            },
          },
        });
      } catch (error) {
        console.error("Fetch admin lessons error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch lessons",
        });
      }
    });

    // Profile stats — total lessons created, total favorites saved, and
    // all public lessons created by this user (newest first) for the profile grid
    app.get("/api/users/:id/profile-stats", async (req, res) => {
      try {
        const { id } = req.params;

        const lessonsCreatedCount = await lessonsCollection.countDocuments({
          creatorId: id,
        });

        const favoritesSavedCount = await favoritesCollection.countDocuments(
          { userId: id }
        );

        const publicLessons = await lessonsCollection
          .find({ creatorId: id, visibility: "Public" })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send({
          success: true,
          data: {
            lessonsCreatedCount,
            favoritesSavedCount,
            publicLessons,
          },
        });
      } catch (error) {
        console.error("Fetch profile stats error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch profile stats",
        });
      }
    });

    // Dashboard overview — counts, recently added lessons, and a 7-day
    // activity chart dataset (lessons created per day) for the user dashboard home
    app.get("/api/users/:id/dashboard-overview", async (req, res) => {
      try {
        // Make sure this endpoint is never cached by the browser/CDN —
        // stale cached JSON is a common reason numbers look "stuck"
        res.set("Cache-Control", "no-store, max-age=0");

        const { id } = req.params;

        const totalLessonsCreated = await lessonsCollection.countDocuments({
          creatorId: id,
        });

        const totalFavoritesSaved = await favoritesCollection.countDocuments(
          { userId: id }
        );

        // Sum of likesCount across all lessons this user created — "Community Reactions"
        const userLessons = await lessonsCollection
          .find({ creatorId: id })
          .project({ likesCount: 1 })
          .toArray();

        const totalLikesReceived = userLessons.reduce(
          (sum, lesson) => sum + (lesson.likesCount || 0),
          0
        );

        const recentLessons = await lessonsCollection
          .find({ creatorId: id })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        // Build a 7-day window (oldest to newest) and count lessons created per day
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // includes today => 7 days total

        const recentWindowLessons = await lessonsCollection
          .find({
            creatorId: id,
            createdAt: { $gte: sevenDaysAgo },
          })
          .project({ createdAt: 1 })
          .toArray();

        const dayLabels = [];
        const dayCounts = {};
        for (let i = 0; i < 7; i++) {
          const day = new Date(sevenDaysAgo);
          day.setDate(day.getDate() + i);
          const key = day.toISOString().slice(0, 10); // YYYY-MM-DD
          dayLabels.push(key);
          dayCounts[key] = 0;
        }

        recentWindowLessons.forEach((lesson) => {
          const key = new Date(lesson.createdAt).toISOString().slice(0, 10);
          if (dayCounts[key] !== undefined) {
            dayCounts[key] += 1;
          }
        });

        const weeklyActivity = dayLabels.map((date) => ({
          date,
          count: dayCounts[date],
        }));

        res.status(200).send({
          success: true,
          data: {
            totalLessonsCreated,
            totalFavoritesSaved,
            totalLikesReceived,
            recentLessons,
            weeklyActivity,
          },
        });
      } catch (error) {
        console.error("Fetch dashboard overview error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch dashboard overview",
        });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});