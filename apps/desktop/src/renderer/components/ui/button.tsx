import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/* DESIGN.md button roles: default = button-primary (near-black pill),
   outline = button-pill-outline (30px outlined pill, inverts on hover),
   secondary = button-secondary (text-only underlined link),
   link = editorial action-blue link; ghost stays as quiet app chrome. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-button ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "rounded-xl border border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground",
        secondary:
          "rounded-xs bg-transparent text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground",
        ghost: "rounded-sm hover:bg-accent hover:text-accent-foreground",
        link: "text-action-blue underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-micro",
        lg: "h-12 px-6",
        icon: "size-9 rounded-full"
      }
    },
    compoundVariants: [{ variant: "secondary", class: "px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
