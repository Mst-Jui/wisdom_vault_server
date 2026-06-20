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
    const usersCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const favoritesCollection = db.collection("favorites");
    const commentsCollection = db.collection("comments");
    const reportsCollection = db.collection("lessonsReports");

    
    // LESSONS
   
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

    
    // FAVORITES
    
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

        res.status(200).send({
          success: true,
          data: lessons,
        });
      } catch (error) {
        console.error("Fetch favorites error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch favorites",
        });
      }
    });

    
    // COMMENTS
  
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

    
    // REPORTS

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

   
    // USERS
  
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

    // await client.db("admin").command({ ping: 1 });
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