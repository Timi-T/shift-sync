-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ShiftPickupRequest" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'PENDING',
    "managerNote" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftPickupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftPickupRequest_shiftId_status_idx" ON "ShiftPickupRequest"("shiftId", "status");

-- CreateIndex
CREATE INDEX "ShiftPickupRequest_userId_status_idx" ON "ShiftPickupRequest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPickupRequest_shiftId_userId_key" ON "ShiftPickupRequest"("shiftId", "userId");

-- AddForeignKey
ALTER TABLE "ShiftPickupRequest" ADD CONSTRAINT "ShiftPickupRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPickupRequest" ADD CONSTRAINT "ShiftPickupRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
